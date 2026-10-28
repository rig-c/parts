/** Analytic controls for two depth fields on one authored weighted attachment. */
import { blendedTurnFixture, blendedTurnIslandsFixture, singleGroupTurnFixture } from '../fixtures/turn_blend.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, type MeshAttachment, type RigOutput } from '../src/rig.ts';
import { computeWorldTransforms, toWorld } from '../src/coords.ts';
import { buildDepth25DTurn } from '../src/turn.ts';
import { PartsError } from '../src/errors.ts';
import { alphaAbove, connectedComponents } from '../src/raster/index.ts';
import { pyRound } from '../src/round.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type Animation = { duration: number; deform?: Array<{ slot: string; attachment: string; keys: Array<{ t: number; vertices?: number[] }> }> };
const mesh = (b: RigOutput) => b.rig.skins.default.neck.neck as MeshAttachment;
const code = (f: () => unknown) => { try { f(); return ''; } catch(e) { if(e instanceof PartsError) return e.problems.map(p=>p.code).join(','); throw e; } };

/** Scalar=120 everywhere; the median is rounded to four places by the public producer. */
function oracle(b: RigOutput, plant: 'none' | 'all' | 'twice' | 'swapped' = 'none', slot = 'neck') {
  const world=computeWorldTransforms(b.rig.bones), att=b.rig.skins.default[slot][slot] as MeshAttachment, z=120*40/255, zRef=pyRound(z,4);
  let max=0, summed=0, pairs=0, missing=0;
  for(const [animation,axis,pivot,band,active] of [
    ['turn','x',16,15,'crown'],['tilt','y',16,12,'crown'],['body_turn','x',24,15,'torso'],
  ] as const) {
    const a=b.motion.animations[animation] as unknown as Animation, d=a.deform?.find(d=>d.slot===slot);
    if(!d && att.weights.flat().some(w=>w.weight>0&&w.bone===active)) { missing++; continue; }
    for(const [ki,deg] of [-band,-band/2,0,band/2,band].entries()) {
      const offsets=d?.keys[ki].vertices??[], delta=-(pivot+z-zRef)*Math.sin(deg*Math.PI/180);
      let at=0;
      for(const row of att.weights) {
        let actualX=0, actualY=0, fraction=0;
        for(const w of row) {
          const m=world.get(w.bone)!;
          let x=offsets[at++]??0,y=offsets[at++]??0;
          if(plant==='all') {x=axis==='x'?delta:0;y=axis==='y'?delta:0;}
          if(plant==='twice') {x*=w.weight;y*=w.weight;}
          if(plant==='swapped') {x=axis==='x'?(w.bone===active?0:delta):0;y=axis==='y'?(w.bone===active?0:delta):0;}
          const wx=m.a*x+m.b*y,wy=m.c*x+m.d*y,expected=w.bone===active?delta:0;
          max=Math.max(max,Math.abs(wx-(axis==='x'?expected:0)),Math.abs(wy-(axis==='y'?expected:0)));
          actualX+=wx*w.weight; actualY+=wy*w.weight;
          if(w.bone===active) fraction+=w.weight;
          pairs++;
        }
        summed=Math.max(summed,Math.abs(actualX-(axis==='x'?fraction*delta:0)),Math.abs(actualY-(axis==='y'?fraction*delta:0)));
      }
      if(d!==undefined && deg!==0 && at!==offsets.length) missing++;
    }
  }
  return {max,summed,pairs,missing};
}

/** Signed triangle areas across a Cartesian slider grid, using emitted offsets and skinning. */
function folds(b: RigOutput, slot = 'neck') {
  const att=b.rig.skins.default[slot][slot] as MeshAttachment, world=computeWorldTransforms(b.rig.bones);
  const key=(animation:string,index:number)=>(b.motion.animations[animation] as unknown as Animation).deform?.find(d=>d.slot===slot)?.keys[index].vertices??[];
  const points=(indices:number[])=>{
    const offsets=['turn','tilt','body_turn'].map((n,i)=>key(n,indices[i])); let at=0;
    return att.weights.map(row=>{
      let x=0,y=0;
      for(const w of row) {
        const [wx,wy]=toWorld(world.get(w.bone)!,w.x+offsets.reduce((s,v)=>s+(v[at]??0),0),w.y+offsets.reduce((s,v)=>s+(v[at+1]??0),0));
        x+=wx*w.weight;y+=wy*w.weight;at+=2;
      }
      return [x,y];
    });
  };
  const area=(p:number[][],i:number)=>{const [a,c,d]=att.triangles.slice(i,i+3).map(v=>p[v]);return (c[0]-a[0])*(d[1]-a[1])-(c[1]-a[1])*(d[0]-a[0]);};
  const rest=points([2,2,2]); let count=0,flat=0,poses=0;
  for(let yaw=0;yaw<5;yaw++)for(let pitch=0;pitch<5;pitch++)for(let body=0;body<5;body++){
    const p=points([yaw,pitch,body]);poses++;
    for(let i=0;i<att.triangles.length;i+=3){const a=area(p,i);if(a*area(rest,i)<0)count++;if(Math.abs(a)<1e-9)flat++;}
  }
  return {count,flat,poses};
}

/** The existing single-group path is owned by the explicit role, including zero-weight entries. */
function legacyRoleError(b: RigOutput, role: 'head' | 'body', slots = ['neck']): number {
  let max = 0;
  const z = 120 * 40 / 255, zRef = pyRound(z, 4), world = computeWorldTransforms(b.rig.bones);
  for (const [animation, axis, pivot, band, group] of [
    ['turn', 'x', 16, 15, 'head'], ['tilt', 'y', 16, 12, 'head'], ['body_turn', 'x', 24, 15, 'body'],
  ] as const) for (const slot of slots) {
    const a = b.motion.animations[animation] as unknown as Animation | undefined, d = a?.deform?.find(d => d.slot === slot);
    if (group !== role) { if (d !== undefined) return Infinity; continue; }
    if (d === undefined) return Infinity;
    const att = b.rig.skins.default[slot][slot] as MeshAttachment;
    for (const [ki, deg] of [-band, -band / 2, 0, band / 2, band].entries()) {
      const values = d.keys[ki].vertices ?? [], delta = -(pivot + z - zRef) * Math.sin(deg * Math.PI / 180);
      let at = 0;
      for (const w of att.weights.flat()) {
        const m = world.get(w.bone)!, x = values[at++] ?? 0, y = values[at++] ?? 0;
        max = Math.max(max, Math.abs(m.a * x + m.b * y - (axis === 'x' ? delta : 0)), Math.abs(m.c * x + m.d * y - (axis === 'y' ? delta : 0)));
      }
      if (deg !== 0 && at !== values.length) return Infinity;
    }
  }
  return max;
}

export function runTurnBlendChecks(say: Say): void {
  const f=blendedTurnFixture(), input=JSON.stringify(f.config), b=buildRig(parseConfig(f.config),f.parts,f.images);
  const normal=oracle(b), all=oracle(b,'all'), twice=oracle(b,'twice'), swapped=oracle(b,'swapped');
  say('BT01_BLEND_WEIGHTS_EACH_GROUP_ONCE',normal.missing===0&&normal.max<0.000003&&normal.summed<0.000003&&all.summed>1&&twice.summed>0.5&&swapped.summed>1,`all five keys on each axis: ${JSON.stringify(normal)}; all-bindings plant ${all.summed}; twice-weighted plant ${twice.summed}; swapped-groups plant ${swapped.summed}`);
  const plain=blendedTurnFixture('none'); delete plain.config.turn;
  const p=buildRig(parseConfig(plain.config),plain.parts,plain.images);
  say('BT02_AUTHORED_BINDINGS_IDLE_AND_PHYSICS_UNCHANGED',JSON.stringify(mesh(b))===JSON.stringify(mesh(p))&&JSON.stringify(b.motion.animations.idle)===JSON.stringify(p.motion.animations.idle)&&JSON.stringify(b.rig.constraints?.filter(c=>c.type==='physics'))===JSON.stringify(p.rig.constraints)&&input===JSON.stringify(f.config)&&['turn','tilt','body_turn'].every(n=>JSON.stringify((b.motion.animations[n] as unknown as Animation).deform?.find(d=>d.slot==='neck')?.keys[2])===JSON.stringify({t:(b.motion.animations[n] as unknown as Animation).duration/2})), 'topology, UVs, weights, all idle keys and physics constraint bytes retained; all neutral turn deforms are empty; config not mutated');
  const crossed=folds(b);
  say('BT03_COMBINED_SLIDER_GRID_HAS_NO_FOLDS',crossed.count===0&&crossed.flat===0,JSON.stringify(crossed));
  const body=blendedTurnFixture();
  body.config.turn={pivot:16,roles:{face:'surface'},body:{pivot:24,roles:{topwear:'surface',neck:'surface'}}};
  const bBody=buildRig(parseConfig(body.config),body.parts,body.images);
  const both=blendedTurnFixture(); (both.config.turn as {body:{roles:Record<string,string>}}).body.roles.neck='surface';
  const bBoth=buildRig(parseConfig(both.config),both.parts,both.images);
  const fields=(v:RigOutput)=>JSON.stringify(['turn','tilt','body_turn'].map(n=>(v.motion.animations[n] as unknown as Animation).deform?.find(d=>d.slot==='neck')));
  say('BT04_EITHER_OR_BOTH_SURFACE_DECLARATIONS_RESOLVE_ONCE',fields(b)===fields(bBody)&&fields(b)===fields(bBoth), 'a neck surface in head, body or both writes the same three per-binding timelines, with no duplicate target');
  const noRole=blendedTurnFixture('none'), unlisted=buildRig(parseConfig(noRole.config),noRole.parts,noRole.images);
  say('BT05_UNLISTED_MESH_STAYS_UNMODIFIED', ['turn','tilt','body_turn'].every(n=>!(unlisted.motion.animations[n] as unknown as Animation).deform?.some(d=>d.slot==='neck'))&&oracle(unlisted).missing===3,'a depth sheet alone does not opt a mesh into turn; the missing-timeline plant is detected');
  const absent=blendedTurnFixture();delete absent.parts.parts[1].depth;
  const oneGroup=blendedTurnFixture();delete (oneGroup.config.turn as {body?:unknown}).body;
  const unit=blendedTurnFixture('unit');
  const outside=blendedTurnFixture();
  (outside.config.bones as unknown[]).push({name:'other',parent:'root',at:[32,34]});
  (outside.config.meshes as Record<string,{segments:unknown[]}>).neck.segments.push('other');
  const explicit=(outside.config.meshes as Record<string,{explicit:{weights:Array<Array<{bone:string;x:number;y:number;weight:number}>>}}>).neck.explicit;
  explicit.weights[13]=[{bone:'torso',x:0,y:16,weight:0.5},{bone:'crown',x:0,y:-10,weight:0.3},{bone:'other',x:0,y:0,weight:0.2}];
  const missingCode=code(()=>buildRig(parseConfig(absent.config),absent.parts,absent.images)),groupCode=code(()=>buildRig(parseConfig(oneGroup.config),oneGroup.parts,oneGroup.images)),unitCode=code(()=>buildRig(parseConfig(unit.config),unit.parts,unit.images)),outsideCode=code(()=>buildRig(parseConfig(outside.config),outside.parts,outside.images));
  say('BT06_MISSING_DEPTH_GROUP_AND_UNIT_ROLE_REFUSED',missingCode.includes('RIG_TURN_SURFACE_DEPTH_REQUIRED')&&groupCode.includes('RIG_TURN_SURFACE_MESH_GROUPS')&&unitCode.includes('CONFIG_TURN_UNIT_MESH_BONES')&&outsideCode.includes('RIG_TURN_SURFACE_MESH_GROUPS'),`depth=${missingCode}; one group=${groupCode}; unit=${unitCode}; ungrouped=${outsideCode}`);
  const rotated=structuredClone(b);
  rotated.rig.bones.find(b=>b.name==='torso')!.rotation=37;
  rotated.rig.bones.find(b=>b.name==='crown')!.rotation=-23;
  buildDepth25DTurn(rotated.rig,rotated.motion,{turn:parseConfig(f.config).turn!,parts:f.parts.parts,images:f.images,regions:{topwear:'torso',face:'crown'},stills:{},boneLandmarks:new Map(),hasAlternateFaceSet:false,surfaceMeshes:[{part:'neck',slot:'neck',attachment:'neck',weights:mesh(rotated).weights,canvas:f.parts.rig_size}]});
  const rotatedRead=oracle(rotated);
  say('BT08_TURNED_BINDING_FRAMES_USE_INVERSE_VECTORS',rotatedRead.max<0.000003&&rotatedRead.summed<0.000003&&rotatedRead.missing===0,`torso +37, crown -23 degrees; ${JSON.stringify(rotatedRead)}`);
  const grid=blendedTurnFixture();
  grid.config.meshes={neck:{grid:4,r:8,segments:[['torso',[32,44],[32,40]],['crown',[32,28],[32,24]]]}};
  const gridBuild=buildRig(parseConfig(grid.config),grid.parts,grid.images),gridRead=oracle(gridBuild);
  say('BT09_GENERATED_WEIGHTED_MESH_USES_THE_SAME_SPLIT',gridRead.max<0.000003&&gridRead.summed<0.000003&&gridRead.missing===0,JSON.stringify(gridRead));
  const islands = blendedTurnIslandsFixture(), islandBuild = buildRig(parseConfig(islands.config), islands.parts, islands.images);
  const islandSlots = islands.islands.map(i => i.slot), islandReads = islandSlots.map(slot => oracle(islandBuild, 'none', slot));
  const islandFolds = islandSlots.map(slot => folds(islandBuild, slot));
  const realAreas = connectedComponents(alphaAbove(islands.images.get('neck')!, 8), 4).stats.slice(1).map(s => s.area);
  const siblingPlant = Math.max(oracle(islandBuild, 'all', 'neck__island2').summed, oracle(islandBuild, 'all', 'neck__island3').summed);
  const samePayload = islands.islands.every(i => { const att = islandBuild.rig.skins.default[i.slot][i.slot] as MeshAttachment; return JSON.stringify(att.weights) === JSON.stringify(i.weights) && JSON.stringify(att.uvs) === JSON.stringify(i.uvs) && JSON.stringify(att.triangles) === JSON.stringify(i.triangles) && att.hull === i.hull; });
  say('BT10_ASSEMBLED_ISLANDS_KEEP_EACH_ATTACHMENTS_GROUP',JSON.stringify(realAreas) === JSON.stringify([80,80,80]) && samePayload && islandReads.every(r => r.missing === 0 && r.max < 0.000003 && r.summed < 0.000003) && islandFolds.every(r => r.count === 0 && r.flat === 0) && siblingPlant > 1,`assembled art areas ${realAreas.join(',')}; mixed/head-only/body-only ${JSON.stringify(islandReads)}; ${islandFolds.reduce((s,r)=>s+r.poses,0)} poses, zero folds/flat; sibling-mask omission plant ${siblingPlant}; payload preserved ${samePayload}`);
  const islandBody = blendedTurnIslandsFixture();
  islandBody.config.turn = { pivot:16,roles:{face:'surface'},body:{pivot:24,roles:{topwear:'surface',neck:'surface'}} };
  const islandBoth = blendedTurnIslandsFixture(); (islandBoth.config.turn as {body:{roles:Record<string,string>}}).body.roles.neck = 'surface';
  const islandFields = (v:RigOutput) => JSON.stringify(['turn','tilt','body_turn'].map(n => (v.motion.animations[n] as unknown as Animation).deform?.filter(d => islandSlots.includes(d.slot))));
  say('BT11_ISLAND_PART_SURFACE_OPT_IN_IS_EXPLICIT_AND_UNIQUE',islandFields(islandBuild) === islandFields(buildRig(parseConfig(islandBody.config),islandBody.parts,islandBody.images)) && islandFields(islandBuild) === islandFields(buildRig(parseConfig(islandBoth.config),islandBoth.parts,islandBoth.images)),'head/body/both declarations yield the same eligible attachment targets; inactive siblings own no timeline');
  const legacyReads: number[] = [];
  for (const group of ['head','body'] as const) for (const role of ['head','body'] as const) for (const zero of [false,true]) {
    const f = singleGroupTurnFixture(group,role,zero);
    legacyReads.push(legacyRoleError(buildRig(parseConfig(f.config),f.parts,f.images),role));
  }
  say('BT12_NO_BLENDED_PART_RETAINS_EXPLICIT_ROLE_WITH_ZERO_WEIGHTS',legacyReads.every(e => e < 0.000003),`eight group/role/zero-weight combinations, maximum legacy field error ${Math.max(...legacyReads)}`);
  const zeroHead = singleGroupTurnFixture('head','head',true); delete (zeroHead.config.turn as {body?:unknown}).body;
  const zeroBody = singleGroupTurnFixture('body','body',true); delete (zeroBody.config.turn as {roles?:unknown}).roles;
  const missingHead = blendedTurnIslandsFixture();
  missingHead.config.turn = { body:{pivot:24,roles:{face:'surface',topwear:'surface',neck:'surface'}} };
  const missingBody = blendedTurnIslandsFixture(); delete (missingBody.config.turn as {body?:unknown}).body;
  const missingGroups = [missingHead,missingBody].map(f => code(() => buildRig(parseConfig(f.config),f.parts,f.images)));
  say('BT13_ZERO_WEIGHT_DOES_NOT_REQUIRE_THE_OTHER_GROUP',code(() => buildRig(parseConfig(zeroHead.config),zeroHead.parts,zeroHead.images)) === '' && code(() => buildRig(parseConfig(zeroBody.config),zeroBody.parts,zeroBody.images)) === '' && missingGroups.every(c => c.includes('RIG_TURN_SURFACE_MESH_GROUPS')),`zero-only foreign subtree accepted with its group absent; real blend missing head/body -> ${missingGroups.join(';')}`);
  const foreign = (weight:number) => {
    const f = blendedTurnIslandsFixture();
    (f.config.bones as unknown[]).push({name:'other',parent:'root',at:[32,34]});
    const m = (f.config.meshes as Record<string,{segments:string[];explicit:{islands:typeof f.islands}}>).neck; m.segments.push('other');
    for(const row of m.explicit.islands[1].weights) {row[0].weight=1-weight;row.push({bone:'other',x:row[0].x,y:row[0].y+10,weight});}
    return f;
  };
  const foreignZero=foreign(0), foreignPositive=foreign(0.2), zeroBuild=buildRig(parseConfig(foreignZero.config),foreignZero.parts,foreignZero.images);
  const zeroRead=oracle(zeroBuild,'none','neck__island2');
  const zeroOffsets=['turn','tilt','body_turn'].every(n => ((zeroBuild.motion.animations[n] as unknown as Animation).deform?.find(d=>d.slot==='neck__island2')?.keys ?? []).every(k => k.vertices === undefined || k.vertices.every((v,i)=>i%4<2||v===0)));
  say('BT14_UNGROUPED_SIBLING_IGNORES_ONLY_ZERO_WEIGHT',zeroRead.missing===0&&zeroRead.summed<0.000003&&zeroOffsets&&code(()=>buildRig(parseConfig(foreignPositive.config),foreignPositive.parts,foreignPositive.images)).includes('RIG_TURN_SURFACE_MESH_GROUPS'),`zero ungrouped influence receives zero pairs, ${JSON.stringify(zeroRead)}; positive ungrouped sibling is refused before any timelines emit`);
  const pureIslands = blendedTurnIslandsFixture();
  pureIslands.islands[0].weights = pureIslands.islands[0].weights.map(row => [{...row[1],weight:1}]);
  const pureBuild=buildRig(parseConfig(pureIslands.config),pureIslands.parts,pureIslands.images), pureError=legacyRoleError(pureBuild,'head',islandSlots);
  say('BT15_NO_BLENDED_ATTACHMENT_RETAINS_ISLAND_PART_ROLE',pureError<0.000003,`separate head/body islands without a mixed attachment keep the authored head surface role; max legacy error ${pureError}`);
  const eligible = (v:RigOutput) => Object.entries({ turn:['neck','neck__island2'], tilt:['neck','neck__island2'], body_turn:['neck','neck__island3'] }).every(([name,want]) => JSON.stringify(((v.motion.animations[name] as unknown as Animation).deform ?? []).filter(d=>islandSlots.includes(d.slot)).map(d=>d.slot)) === JSON.stringify(want));
  const inertPlant=structuredClone(islandBuild), inertBody=inertPlant.motion.animations.body_turn as unknown as Animation;
  inertBody.deform!.push({slot:'neck__island2',attachment:'neck__island2',keys:[{t:0,vertices:Array<number>(8).fill(0)},{t:inertBody.duration/2},{t:inertBody.duration,vertices:Array<number>(8).fill(0)}]});
  say('BT16_INACTIVE_TIMELINE_IS_OMITTED_NOT_ZERO_KEYED',eligible(islandBuild)&&!eligible(inertPlant),'only mixed+head siblings on yaw/pitch and mixed+body siblings on body yaw; adding an inactive zero timeline is detected (Core A40 refuses that overwrite)');
  const zeroRows=blendedTurnIslandsFixture();
  for(const row of zeroRows.islands[1].weights) for(const w of row) w.weight=0;
  const zeroRowCode=code(()=>buildRig(parseConfig(zeroRows.config),zeroRows.parts,zeroRows.images));
  say('BT17_INACTIVE_SIBLING_STILL_VALIDATES_ITS_BINDINGS',zeroRowCode.includes('RIG_TURN_SURFACE_MESH_BINDINGS'),'an all-zero sibling is in neither group, but omitting its timeline does not bypass the existing weights-close-at-one refusal');
  const moved=blendedTurnFixture();(moved.config.turn as {body:{roles:Record<string,string>}}).body.roles={topwear:'unit',neck:'surface'};
  const movedCode=code(()=>buildRig(parseConfig(moved.config),moved.parts,moved.images));
  say('BT07_SHARED_MOVING_FRAME_REMAINS_REFUSED',movedCode.includes('RIG_TURN_SURFACE_MESH_BINDINGS'),'a surface spanning both subtrees does not excuse another role moving its torso ancestor; no second carrier displacement is silently added');
}
