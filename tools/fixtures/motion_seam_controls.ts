/** Synthetic source-contract controls for explicit motion seams; no renderer or private inputs. */
import { writePng } from '../../src/raster/png.ts';
import { newRaster } from '../../src/raster/types.ts';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mergeConfigProposal } from '../../src/configwrite.ts';
import { draftMotionSeams, motionSeamProblems } from '../../src/motionseams.ts';
import { SEAM_GEOMETRY_COORDINATES, seamJointPose, seamPoseFrame, seamStaticRange, type SeamMatrix } from '../../src/motionseampose.ts';
import { motionSeamLine, motionSeamSelection, motionSeamWarnText, openingOverFloor, readMotionSeams, enrichMotionSeamPoses, type MotionSeamRow } from '../../src/check.ts';
import { parseConfig, parseEarlyConfig, parseProposalSections, type CharacterConfig } from '../../src/config.ts';
import { readParts, serializeParts, type PartsFile, type PartRecord } from '../../src/parts.ts';
import { stageFields } from '../../src/assemble.ts';
import { withTurn, PROPOSAL_CONFIG_SECTIONS, type Proposal } from '../../src/propose.ts';
import { PartsError } from '../../src/errors.ts';

type Say = (name: string, ok: boolean, detail: string, why: string) => void;
const matrix = (degrees: number): SeamMatrix => { const a = degrees * Math.PI / 180; return { a: Math.cos(a), b: -Math.sin(a), c: Math.sin(a), d: Math.cos(a), worldX: 0, worldY: 0 }; };
const close = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < 1e-10;
const refuses = (read: () => unknown, text: string): boolean => { try { read(); return false; } catch (e) { return e instanceof PartsError && e.problems.some(p => `${p.code} ${p.object} ${p.detail}`.includes(text)); } };
const rec = (name: string, from: string): PartRecord => ({ name, from, x: 0, y: 0, w: 4, h: 4, opaque_px: 16, projected_core_px: 16, source_px_taken: 16, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 });

export function runMotionSeamContractCases(say: Say): void {
  const parts: PartsFile = { rig_size: [16,16], scale_rig_per_source: 1, ghost_px: {}, parts: [rec('cloth', 'full:topwear'), rec('arm', 'full:handwear-l')] };
  const cfg: CharacterConfig = { key: 'fixture', assemble: { rig_scale: 1, plan: [['cloth','full','topwear'],['arm','full','handwear-l']] },
    bones: [{ name: 'lower', parent: 'root', at: [8,12] }, { name: 'upper', parent: 'lower', at: [8,6] }, { chain: 'branch', parent: 'upper', points: [[4,4],[3,8]], tip: [2,12] }],
    meshes: { cloth: { grid: 2, r: 2, segments: [['upper',[8,0],[8,6]],['lower',[8,6],[8,14]]] }, branch_art: { grid: 2, r: 2, segments: ['branch'] } }, regions: {}, motion: { duration: 1, tracks: [] } };
  cfg.meshes.arm = cfg.meshes.branch_art; delete cfg.meshes.branch_art;
  const original = JSON.stringify(cfg), raw = serializeParts(parts);
  const declarations = draftMotionSeams(cfg, parts.parts);
  const missing = motionSeamProblems([{ part: 'absent', neighbour: 'arm' }], new Set(['cloth','arm']), 'config.motion_seams', 'CONFIG_MOTION_SEAM');
  const reverse = motionSeamProblems([...declarations, { part: 'arm', neighbour: 'cloth' }], new Set(['cloth','arm']), 'config.motion_seams', 'CONFIG_MOTION_SEAM');
  say('MS01_SOURCE_PROVENANCE_AND_TWO_NAMED_TRUNK_CARRIERS_DECLARE_WITHOUT_MUTATION', JSON.stringify(declarations) === '[{"part":"cloth","neighbour":"arm"}]' && JSON.stringify(cfg) === original && serializeParts(parts) === raw && missing.some(p => p.detail.includes('absent')) && reverse.length === 1, JSON.stringify({ declarations, missing, reverse }), 'No spelling or motion key selects the declaration; misses and reversed duplicates are named.');
  const unrelated = { ...cfg, bones: cfg.bones.map(b => 'chain' in b ? { ...b, parent: 'root' } : b) };
  const shared = { ...cfg, meshes: { ...cfg.meshes, arm: { grid: 2, r: 2, segments: ['lower'] } } };
  const wrongSource = parts.parts.map(p => ({ ...p, from: 'full:neckwear' }));
  say('MS02_UNPROVEN_CARRIERS_AND_PROVENANCE_DO_NOT_DECLARE', draftMotionSeams(unrelated, parts.parts).length === 0 && draftMotionSeams(shared, parts.parts).length === 0 && draftMotionSeams(cfg, wrongSource).length === 0, 'unrelated parent / shared trunk binding / unrelated provenance', 'An ancestor in common does not establish the source-bound trunk/handwear structure.');
  const declared = { ...parts, motion_seams: declarations };
  const pairs = motionSeamSelection(declared, []).pairs;
  const removed = motionSeamSelection(parts, []).pairs;
  const jointParts: PartsFile = { ...parts, parts: parts.parts.map((p,i) => ({ ...p, limb: { name: 'branch', segment: i, of: 'source', bone: i === 0 ? 'upper' : 'branch0' } })) };
  const legacy = motionSeamSelection(jointParts, []).pairs;
  const rows: MotionSeamRow[] = [{ pair: pairs[0].pair, animation: 'added', status: 'read', drawn: 3, banded: 3, opens: [2], px: [4], max_px: 4, under_floor: [1] }];
  const line = motionSeamLine(pairs, ['idle','added'], 12, rows);
  say('MS03_EXPLICIT_DECLARATION_REMOVAL_SILENCES_WITHOUT_A_FALLBACK', pairs.length === 1 && removed.length === 0 && line.status === 'WARN' && line.warnings === 1 && line.roots === undefined && legacy.length === 1 && motionSeamSelection({ ...jointParts, motion_seams: declarations }, []).pairs.length === 1 && !openingOverFloor({ px: 2, cell: 1, box: [0,0,2,1] }) && openingOverFloor({ px: 4, cell: 1, box: [0,0,2,2] }), JSON.stringify({ pairs, removed, line, legacy }), 'WARN keeps the old strict one-cell floor and no root bar; declarations merge with existing limb pairs.');
  const bare = parseConfig(cfg), decorated = parseConfig({ ...cfg, motion_seams: declarations });
  const st = { resolution: 16, steps: 1, seed: 1, offload: true, head_box: [0,0,8,8] as [number,number,number,number] };
  const early = parseEarlyConfig({ ...cfg, seethrough: st, motion_seams: declarations }, 'assemble');
  const fields = stageFields(early);
  const proposal: Proposal = { bones: cfg.bones, meshes: cfg.meshes, regions: {}, motion: { duration: 1, tracks: [] }, motion_seams: declarations, proposed_rig_scale: 1, notes: [] };
  const turned = withTurn(proposal, { turn: { pivot: 0, depths: {} }, notes: [] });
  const encoded = JSON.parse(serializeParts(declared)) as PartsFile;
  const written = mergeConfigProposal(cfg, { kind: 'proposal', proposal, sections: PROPOSAL_CONFIG_SECTIONS });
  const writtenConfig = parseConfig(written.config);
  say('MS04_CONFIG_EARLY_DOOR_PARTS_AND_TURN_PRESERVE_THE_OPTIONAL_DECLARATION', JSON.stringify(bare) === original && decorated.motion_seams === declarations && fields.motion_seams === declarations && JSON.stringify(encoded.motion_seams) === JSON.stringify(declarations) && turned.motion_seams === declarations && JSON.stringify(writtenConfig.motion_seams) === JSON.stringify(declarations) && PROPOSAL_CONFIG_SECTIONS.includes('motion_seams') && parseProposalSections(proposal).motion_seams === declarations && refuses(() => parseConfig({ ...cfg, motion_seams: [{ part: 'absent', neighbour: 'arm' }] }), 'CONFIG_MOTION_SEAM'), JSON.stringify(fields.motion_seams), 'Absent declaration is untouched; all copy/turn/assembly contracts carry it; unknown output names refuse.');
  const identity = matrix(0);
  const parentOnly = seamJointPose('joint','parent','normal',identity,matrix(40),identity,matrix(40),[-30,90]);
  const child = seamJointPose('joint','parent','normal',matrix(10),matrix(65),matrix(0),matrix(40),[-30,90]);
  const inherit = seamJointPose('joint','parent','onlyTranslation',identity,matrix(40),identity,matrix(40),[-30,90]);
  const shear = seamJointPose('joint','parent','normal',identity,{...identity,b: 0.5},identity,identity,[-30,90]);
  const degenerate = seamJointPose('joint','parent','normal',identity,{...identity,a: 0,c: 0},identity,identity,[-30,90]);
  const winding = seamJointPose('joint','parent','normal',identity,matrix(30),identity,identity,[-360,360]);
  const noRange = seamJointPose('joint','parent','normal',identity,matrix(20),identity,identity,null);
  say('MS05_ACTUAL_SETUP_AND_PARENT_FRAME_CANCEL_PARENT_ONLY_ROTATION', close(parentOnly.parent_relative_setup_axis_delta_degrees_mod360,0) && close(child.parent_relative_setup_axis_delta_degrees_mod360,15) && close(noRange.parent_relative_setup_axis_delta_degrees_mod360,20) && [inherit,shear,degenerate,winding,noRange].every(p => p.comparison === 'unavailable') && degenerate.world_x_axis_degrees === null, JSON.stringify({ parentOnly, child, inherit, shear, degenerate, winding, noRange }), 'Modulo-360 axes, not keyed values: special inheritance/shear/singular axes/winding/no range are explicitly unavailable comparisons.');
  const viewport = { x: 0,y: 0,width: 16,height: 16,scale: 1,pixelWidth: 16,pixelHeight: 16 };
  const geometry = { spec: 'rigc-geometry/1', coordinates: SEAM_GEOMETRY_COORDINATES, bones: [{name:'parent',parent:null},{name:'joint',parent:'parent'}], fps:12, animation: 'added', viewport, setup: { bones: [{ name: 'parent', ...identity },{ name: 'joint', ...identity }] }, frames: [{ index: 0,time: 0,bones: [{ name: 'parent', ...identity },{ name: 'joint', ...matrix(15) }] },{ index: 2,time: 0.125,bones: [{ name: 'parent', ...matrix(40) },{ name: 'joint', ...matrix(65) }] }] };
  const joints = [{ bone: 'joint',parent: 'parent',inherit: 'normal',range: [-30,90] as [number,number] }];
  const cohort = { animation:'added', fps:12, viewport, frames:[{index:0},{index:2}] };
  const pose = seamPoseFrame(geometry,'added',2,0.125,cohort,joints);
  say('MS06_NONZERO_FRAME_ZERO_IS_NOT_SETUP_AND_RAW_FRAME_TIME_IS_BOUND', close(pose.joints[0].parent_relative_setup_axis_delta_degrees_mod360,25) && pose.time === 0.125 && refuses(() => seamPoseFrame(geometry,'wrong',2,0.125,cohort,joints),'same-animation') && refuses(() => seamPoseFrame(geometry,'added',2,2/12,cohort,joints),'frame/time') && refuses(() => seamPoseFrame(geometry,'added',1,0.125,cohort,joints),'frame/time') && refuses(() => seamPoseFrame(geometry,'added',2,0.125,{...cohort,viewport:{...viewport,scale:2}},joints),'viewport') && refuses(() => seamPoseFrame({...geometry,setup:{bones:[]}},'added',2,0.125,cohort,joints),'matrix'), JSON.stringify(pose), 'Frame0 is already +15deg. Actual setup -> posed delta is +25deg, not +10deg; time is 0.125 from the raw hit, not index/fps.');
  rows[0].pose_at_worst = pose;
  const text = motionSeamWarnText(rows[0]);
  say('MS07_WARN_TEXT_NAMES_ANIMATION_SPANS_WORST_TIME_EACH_JOINT_AND_STATIC_RANGE', text.includes('"added"') && text.includes('worst frame 2 (t = 0.125s)') && text.includes('"joint"') && text.includes('modulo360') && text.includes('[-30,90]'), text, 'The line carries actual posed evidence alongside the unchanged static range.');
  const home = mkdtempSync(join(tmpdir(), 'parts-motion-seam-'));
  try {
    const serialized = join(home, 'parts.json');
    writeFileSync(serialized, serializeParts(declared));
    const read = readParts(serialized);
    writeFileSync(serialized, JSON.stringify({ ...declared, motion_seams: [{ part: 'missing', neighbour: 'arm' }] }));
    const badPart = refuses(() => readParts(serialized), 'PARTS_MOTION_SEAM');
    const shapeBad = [null, {}, [{part:'cloth',neighbour:'cloth'}], [{part:'cloth',neighbour:'arm',unexpected:true}]];
    say('MS08_PARTS_READER_AND_CONFIG_REFUSALS_ARE_SHARED_AND_NAMED', JSON.stringify(read.motion_seams) === JSON.stringify(declarations) && badPart && shapeBad.every(value => motionSeamProblems(value,new Set(['cloth','arm']),'motion_seams','CONFIG_MOTION_SEAM').length > 0), 'round-trip + missing output + array/entry/self/unknown field plants', 'The real parts reader refuses malformed declarations; absent serialization remains untouched.');
    const skeleton = { bones: [{ name:'root' },{ name:'lower',parent:'root' },{ name:'upper',parent:'lower' },{ name:'branch0',parent:'upper' }],
      slots: [{name:'cloth',bone:'upper',attachment:'cloth'},{name:'arm',bone:'branch0',attachment:'arm'}],
      skins: { default: { cloth:{cloth:{type:'region'}},arm:{arm:{type:'region'}} } } };
    const setup = skeleton.bones.map(b => ({name:b.name,...identity}));
    const frameBones = skeleton.bones.map(b => ({name:b.name,...matrix(b.name==='branch0'?45:b.name==='upper'?20:0)}));
    const animationGeometry = { spec:'rigc-geometry/1',coordinates:SEAM_GEOMETRY_COORDINATES,fps:12,bones:skeleton.bones.map(b=>({name:b.name,parent:b.parent??null})),animation:'added',viewport,setup:{bones:setup},rest:[],frames:[0,1,2,3].map(index=>({index,time:index/8,bones:frameBones,attachments:[{slot:'cloth',attachment:'cloth'},{slot:'arm',attachment:'arm'}]})) };
    mkdirSync(join(home,'added'));
    mkdirSync(join(home,'idle'));
    writeFileSync(join(home,'frames.json'),JSON.stringify({spec:'rigc-frames/1',viewport,background:[232,232,232,255],sets:['idle','added'].map(animation=>({animation,dir:animation,written:4,sampled:4,stride:1,duration:0.375,fps:12}))}));
    for(const animation of ['idle','added']) for(const index of [0,1,2,3]) writePng(join(home,animation,`f${String(index).padStart(4,'0')}.png`),newRaster(16,16));
    const hit = (index:number,px=4) => ({index,time:index/8,px,cell:1,box:[0,0,2,2]});
    const rawPair = {a:'cloth',b:'arm',status:'read',drawn:4,banded:4,opens:[0,1,2,3],maxPx:100,gap:{frames:[{...hit(0,100),box:[0,0,100,1]},hit(2),hit(1),hit(3,2)]},ghost:{frames:[hit(1)]}};
    for(const animation of ['idle','added']) writeFileSync(join(home,animation,'seam.json'),JSON.stringify({spec:'rigc-seam/1',animation,fps:12,pairs:[animation==='idle'?{...rawPair,opens:[],gap:{frames:[]},ghost:{frames:[]}}:rawPair]}));
    const geometryPath=join(home,'added','geometry.json');
    writeFileSync(geometryPath,JSON.stringify(animationGeometry));
    const reading=readMotionSeams(home,['idle','added'],12,pairs);
    const legacyPairs=motionSeamSelection(jointParts,[]).pairs;
    const legacyReading=readMotionSeams(home,['idle','added'],12,legacyPairs);
    enrichMotionSeamPoses(home,skeleton,jointParts,legacyPairs,legacyReading);
    enrichMotionSeamPoses(home,skeleton,parts,pairs,reading);
    const worst=reading[1].worst;
    const corrupted={...animationGeometry,frames:animationGeometry.frames.map(f=>({...f,time:f.time+1}))};
    writeFileSync(geometryPath,JSON.stringify(corrupted));
    const mismatch=refuses(()=>enrichMotionSeamPoses(home,skeleton,parts,pairs,readMotionSeams(home,['idle','added'],12,pairs)),'frame/time');
    writeFileSync(geometryPath,JSON.stringify(animationGeometry));
    const stable=JSON.stringify(legacyReading[1].pose_at_worst)===JSON.stringify(reading[1].pose_at_worst);
    say('MS09_REAL_RAW_READER_TIE_AND_ALL_ANIMATIONS_ENRICH_LEGACY_AND_NEW_WARN_IDENTICALLY', reading.length===2 && reading[0].opens.length===0 && worst?.index===1 && worst.kind==='gap' && reading[1].pose_at_worst?.time===0.125 && reading[1].under_floor.join(',')==='0,3' && stable && mismatch && readFileSync(geometryPath,'utf8')===JSON.stringify(animationGeometry), JSON.stringify({worst,pose:reading[1].pose_at_worst,stable,mismatch}), 'Earliest above-floor tie wins, including gap/ghost ties. Legacy limb WARN uses the same active seam geometry and actual time as explicit declarations. A wrong time refuses.');
    say('MS12_WORST_IS_ABOVE_FLOOR_EVEN_WHEN_THE_LARGEST_RAW_HIT_IS_A_CRACK', rawPair.maxPx===100 && reading[1].max_px===4 && worst?.px===4 && worst.index===1 && reading[1].under_floor.includes(0), JSON.stringify({rawMax:rawPair.maxPx,worst,under:reading[1].under_floor}), 'The 100-cell hit in a 100-cell-long box stays under the strict floor; the smaller four-cell opening wins.');
  } finally { rmSync(home,{recursive:true,force:true}); }

  const badFrames = [
    {...geometry,frames:[{...geometry.frames[0],index:1},geometry.frames[1]]},
    {...geometry,frames:[geometry.frames[0]]},
    {...geometry,frames:[geometry.frames[0],{...geometry.frames[1],index:0}]},
    {...geometry,frames:[{...geometry.frames[0],bones:[{name:'parent',...identity}]},geometry.frames[1]]},
  ];
  const badHeaders = [
    {...geometry,coordinates:undefined}, {...geometry,coordinates:'image pixels, y down'},
    {...geometry,bones:undefined}, {...geometry,bones:[{name:'parent',parent:null}]},
    {...geometry,bones:[{name:'parent',parent:null},{name:'joint',parent:null}]},
    {...geometry,bones:[{name:'parent',parent:null},{name:'joint'}]},
  ];
  say('MS11_COORDINATE_PARENT_METADATA_AND_UNSELECTED_COHORT_CORRUPTION_REFUSE', badFrames.every(g=>refuses(()=>seamPoseFrame(g,'added',2,0.125,cohort,joints), 'CHECK_GEOMETRY_FILE')) && badHeaders.every(g=>refuses(()=>seamPoseFrame(g,'added',2,0.125,cohort,joints), 'CHECK_GEOMETRY_FILE')) && seamPoseFrame(geometry,'added',2,0.125,cohort,joints).index===2, JSON.stringify({badFrames:badFrames.length,badHeaders:badHeaders.length}), 'Actual stock coordinate constants and source parent roster are required. Missing/replaced/duplicate unselected indices or an unselected matrix cannot hide behind the correct worst hit.');
  const sameRanges=seamStaticRange([[-30,90],[-30,90]]);
  const ambiguousRanges=seamStaticRange([[-30,90],[-20,80]]);
  const ambiguousPose=seamPoseFrame(geometry,'added',2,0.125,cohort,[{...joints[0],...ambiguousRanges}]);
  say('MS13_IDENTICAL_RANGES_DEDUP_AND_CONFLICTING_RANGES_STAY_AMBIGUOUS', JSON.stringify(sameRanges.range)==='[-30,90]' && ambiguousRanges.range===null && ambiguousPose.joints[0].reason?.includes('ambiguous declared static ranges')===true && !ambiguousPose.joints[0].reason?.includes('no declared static range'), JSON.stringify({sameRanges,ambiguousPose}), 'Conflicting source limb ranges on one bone are not reported as an absent declaration.');

  const root = resolve(import.meta.dir, '../..');
  const copyDocs = ['README.md','docs/AUTHORING.md','docs/MIGRATION.md','skills/rig-parts/SKILL.md'];
  const sections: readonly string[] = PROPOSAL_CONFIG_SECTIONS;
  const faults: string[] = [];
  for (const path of copyDocs) {
    const text = readFileSync(join(root,path),'utf8');
    let sites=0;
    for(const match of text.matchAll(/\b(?:copy|paste)\b([\s\S]{0,240}?)\binto\b/gi)) {
      const names=[...match[1].matchAll(/[a-z_]+/g)].map(m=>m[0]).filter(n=>sections.includes(n)||n==='notes');
      if(names.length===0) continue;
      sites++;
      if(names.join(',')!==sections.join(',')) faults.push(path+': '+names.join(','));
    }
    if(sites===0) faults.push(path+': no copy site');
  }
  const guide=readFileSync(join(root,'docs/AUTHORING.md'),'utf8');
  const anchors=['CONFIG_MOTION_SEAM','PARTS_MOTION_SEAM','CHECK_MOTION_SEAM_DECLARATION'];
  say('MS10_DOCS_NAME_THE_SECTION_REFUSALS_AND_POSED_COORDINATE_CONTRACT', faults.length===0 && readFileSync(join(root,'docs/STABILITY.md'),'utf8').split('<!-- stable:config -->')[1]?.split('<!-- /stable:config -->')[0].includes('`motion_seams`')===true && anchors.every(n=>guide.split('<a id="'+n+'"></a>').length===2) && ['docs/AUTHORING.md','docs/STABILITY.md','docs/MIGRATION.md'].every(path=>{const text=readFileSync(join(root,path),'utf8');return text.includes('motion_seams')&&text.includes('modulo')&&text.includes('WARN');}), JSON.stringify({faults,anchors}), 'All required TY18 copy-list sentences and each new named refusal are documented with explicit modulo/unavailable WARN semantics.');

}
if (import.meta.main) {
  let failures = 0, count = 0;
  runMotionSeamContractCases((name, ok, detail) => { count++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); });
  console.log(`motion-seam pure controls: ${count - failures} PASS / ${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
}
