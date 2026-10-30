import { edgeLength } from './length.ts';
import { createHash } from 'node:crypto';
/** Source support at declared joints (#888). Geometry is in stage pixels, y down.
 * No scene, motion, material or threshold is inferred. This measures pixel-cell
 * support on normal rays, not rendered seam visibility or a continuous surface.
 */
import { type Raster } from './raster/types.ts';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { refuseIfAny, type Problem } from './errors.ts';
import type { PartsFile } from './parts.ts';
export type Point = [number, number];
export interface JointMaterial {
  part: string;
  joint: string;
  at: Point;
  /** Points into the piece; need not be unit length. */
  axis: Point;
  reach_px: number;
  /** Continuous interval in stage coordinates (positive clockwise). */
  bend_degrees: Point;
}
export interface MaterialEdge { a: Point; b: Point; inward: Point; opaque_t?: Array<[number, number]>; opaque_length_px?: number; opaque_intervals?: number }
export interface MaterialSource { part: string; from: string[]; source_sha256: string[]; edges: MaterialEdge[] }
export const CUT_MATERIAL_SOURCES = 'cut_material_sources.json';
export const CUT_MATERIAL_SPEC = 'rig-parts-cut-material-sources/1';
export interface PlacedArt { x: number; y: number; image: Raster }
export interface MaterialRow {
  part: string; joint: string; edge: [Point, Point]; edge_length_px: number; within_reach_px: number;
  found_px: number; required_px: number; rays: number;
  status: 'PASS' | 'FAIL' | 'SKIP'; reason?: string;
}
export const CUT_MATERIAL_LINE = 'CUT_JOINT_MATERIAL';
export interface MaterialLine { status: 'PASS' | 'FAIL' | 'SKIP'; rows: MaterialRow[]; reason?: string }
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const pair = (x: unknown): x is Point => Array.isArray(x) && x.length === 2 && x.every(num);
export function jointMaterialProblems(raw: unknown, at: string): Problem[] {
  const out: Problem[] = [];
  const fail = (object: string, detail: string): void => { out.push({code:'REQUIREMENTS_FIELD', object, detail}); };
  if (!Array.isArray(raw) || raw.length === 0) return [{code:'REQUIREMENTS_FIELD',object:at,detail:'requires a nonempty list of {part, joint, at, axis, reach_px, bend_degrees}; omit cut_material when undeclared'}];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const where = `${at}[${i}]`;
    if (!obj(r)) { fail(where,'requires an object'); return; }
    for (const k of Object.keys(r)) if (!['part','joint','at','axis','reach_px','bend_degrees'].includes(k)) fail(`${where}.${k}`,'is unknown; no guessed fields are read');
    for (const k of ['part','joint']) if (typeof r[k] !== 'string' || r[k].trim() === '') fail(`${where}.${k}`,'requires a nonempty name');
    for (const k of ['at','axis','bend_degrees']) if (!pair(r[k])) fail(`${where}.${k}`,'requires two finite numbers');
    if (pair(r.axis) && (edgeLength(...r.axis) === 0 || !Number.isFinite(edgeLength(...r.axis)))) fail(`${where}.axis`,'requires a nonzero inward direction');
    if (!num(r.reach_px) || r.reach_px <= 0) fail(`${where}.reach_px`,'requires a finite positive stage-pixel reach');
    if (pair(r.bend_degrees) && (r.bend_degrees[0] > r.bend_degrees[1] || r.bend_degrees[0] < -180 || r.bend_degrees[1] > 180)) fail(`${where}.bend_degrees`,'requires an ordered interval inside [-180,180], in stage coordinates');
    const key = JSON.stringify([r.part,r.joint]);
    if (seen.has(key)) fail(where,'declares this part and joint twice');
    seen.add(key);
  });
  return out;
}
const point = (a: Point, b: Point, t: number): Point => [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const unit = (p: Point): Point => { const d = edgeLength(...p); return [p[0]/d,p[1]/d]; };
const dot = (a: Point, b: Point): number => a[0]*b[0]+a[1]*b[1];
export function opaqueAt(arts: readonly PlacedArt[], x: number, y: number): boolean {
  return arts.some(a => { const ix = Math.floor(x-a.x), iy = Math.floor(y-a.y); return ix >= 0 && iy >= 0 && ix < a.image.width && iy < a.image.height && a.image.data[(iy*a.image.width+ix)*4+3] > OPAQUE_ALPHA_ABOVE; });
}
/** Exact parameter breaks at pixel-cell boundaries, no spatial step or epsilon. */
function breaks(a: Point, b: Point, arts: readonly PlacedArt[]): number[] {
  const ts = new Set([0,1]);
  for (const r of arts) for (const k of [0,1] as const) {
    const lo = k === 0 ? r.x : r.y, size = k === 0 ? r.image.width : r.image.height;
    if (a[k] === b[k]) continue;
    const start = Math.max(lo,Math.ceil(Math.min(a[k],b[k]))), end = Math.min(lo+size,Math.floor(Math.max(a[k],b[k])));
    for (let v = start; v <= end; v++) { const t = (v-a[k])/(b[k]-a[k]); if (t > 0 && t < 1) ts.add(t); }
  }
  return [...ts].sort((x,y)=>x-y);
}
/** On a source pixel boundary the art must exist on both sides of the cut. */
function across(arts: readonly PlacedArt[], p: Point, n: Point): boolean {
  const cell = (direction: number, k: 0|1): number => Number.isInteger(p[k]) && direction < 0 ? p[k]-0.5 : p[k];
  return opaqueAt(arts,cell(n[0],0),cell(n[1],1)) && opaqueAt(arts,cell(-n[0],0),cell(-n[1],1));
}
export function polygonMaterialEdges(poly: readonly Point[]): MaterialEdge[] {
  const area = poly.reduce((s,a,i)=>{ const b=poly[(i+1)%poly.length]; return s+a[0]*b[1]-a[1]*b[0]; },0);
  return poly.flatMap((a,i)=>{const b=poly[(i+1)%poly.length],d=edgeLength(b[0]-a[0],b[1]-a[1]);return d===0?[]:[{a,b,inward:area>0?[-(b[1]-a[1])/d,(b[0]-a[0])/d] as Point:[(b[1]-a[1])/d,-(b[0]-a[0])/d] as Point}];});
}
/** Contiguous opaque cells from the joint plane outward. A hole ends support. */
function support(arts: readonly PlacedArt[], start: Point, n: Point): number {
  const limit = arts.reduce((m,a)=>Math.max(m,edgeLength(a.x-start[0],a.y-start[1])+a.image.width+a.image.height),0);
  if (limit === 0) return 0;
  const end: Point = [start[0]-n[0]*limit,start[1]-n[1]*limit], ts=breaks(start,end,arts);
  for(let i=0;i+1<ts.length;i++){ const p=point(start,end,(ts[i]+ts[i+1])/2);if(!opaqueAt(arts,...p))return ts[i]*limit; }
  return limit;
}
/** max outward displacement of t*(-ny,nx), retained as a scalar instrument. */
export function bendDepth(t: number, degrees: Point): number {
  const angles = [...degrees];
  for (const a of [-90,90]) if (a >= degrees[0] && a <= degrees[1]) angles.push(a);
  return Math.max(0,...angles.map(a=>t*Math.sin(a*Math.PI/180)));
}
/** Exact quadrant values avoid inventing support for sin(pi)'s roundoff. */
function trig(angle: number): [number, number] {
  const q = angle / (Math.PI / 2);
  if (Number.isInteger(q)) {
    const k = ((q % 4) + 4) % 4;
    return [[1,0],[0,1],[-1,0],[0,-1]][k] as [number, number];
  }
  return [Math.cos(angle), Math.sin(angle)];
}
/** Clip a convex polygon by a closed half-plane. No geometric tolerance. */
function clip(poly:Point[],inside:(p:Point)=>number):Point[]{
  const out:Point[]=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],fa=inside(a),fb=inside(b);
    if(fa>=0)out.push(a);
    if((fa<0&&fb>0)||(fa>0&&fb<0))out.push(point(a,b,fa/(fa-fb)));
  }
  return out;
}
function polygonArea(poly:Point[]):number{return Math.abs(poly.reduce((s,a,i)=>{const b=poly[(i+1)%poly.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;}
function convexHull(points:Point[]):Point[]{
  const sorted=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const turn=(a:Point,b:Point,c:Point):number=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=(ps:Point[]):Point[]=>{const out:Point[]=[];for(const p of ps){while(out.length>=2&&turn(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}return out;};
  return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];
}
/** Empty exterior is four rectangles, so a distant declared joint never
 * turns empty space into an unbounded pixel walk. Interior cells remain exact. */
function emptyRectangles(at:Point,radius:number,arts:readonly PlacedArt[]):Array<[number,number,number,number]>{
  const x0=Math.floor(at[0]-radius),x1=Math.ceil(at[0]+radius),y0=Math.floor(at[1]-radius),y1=Math.ceil(at[1]+radius);
  if(arts.length===0)return [[x0,y0,x1,y1]];
  const left=Math.max(x0,Math.min(...arts.map(a=>a.x))),right=Math.min(x1,Math.max(...arts.map(a=>a.x+a.image.width))),top=Math.max(y0,Math.min(...arts.map(a=>a.y))),bottom=Math.min(y1,Math.max(...arts.map(a=>a.y+a.image.height)));
  if(left>=right||top>=bottom)return [[x0,y0,x1,y1]];
  const out:Array<[number,number,number,number]>=[];
  for(const rect of [[x0,y0,x1,top],[x0,bottom,x1,y1],[x0,top,left,bottom],[right,top,x1,bottom]] as Array<[number,number,number,number]>)if(rect[0]<rect[2]&&rect[1]<rect[3])out.push(rect);
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)if(!opaqueAt(arts,x+0.5,y+0.5))out.push([x,y,x+1,y+1]);
  return out;
}
/** The inverse rotation of a full point, with no joint-plane projection. */
function rotated(p:Point,angle:number):Point{const [c,s]=trig(angle);return [p[0]*c+p[1]*s,p[1]*c-p[0]*s];}
const cross=(a:Point,b:Point):number=>a[0]*b[1]-a[1]*b[0];
/**
 * Segment-vs-convex-polygon intersection throughout an angle interval. Changes
 * of incidence occur only when an endpoint crosses a polygon edge, the source
 * line crosses a vertex, or an edge becomes parallel. All are sinusoid roots.
 * One angle inside each resulting interval has the same intersection topology.
 */
function sweptSegmentWitness(a:Point,b:Point,poly:Point[],degrees:Point):Point|null{
  if(poly.length<3||polygonArea(poly)===0)return null;
  const lo=degrees[0]*Math.PI/180,hi=degrees[1]*Math.PI/180,angles=new Set<number>([lo,hi]);
  const add=(angle:number):void=>{if(angle>=lo&&angle<=hi)angles.add(angle);};
  const roots=(A:number,B:number,C:number):void=>{
    const radius=edgeLength(A,B);if(radius===0||Math.abs(C)>radius)return;
    const phase=Math.atan2(B,A),offset=Math.acos(C/radius);
    for(const k of [-1,0,1]){add(phase+offset+k*2*Math.PI);add(phase-offset+k*2*Math.PI);}
  };
  const delta:Point=[b[0]-a[0],b[1]-a[1]];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],edge:Point=[q[0]-p[0],q[1]-p[1]],normal:Point=[-edge[1],edge[0]],C=dot(normal,p);
    for(const endpoint of [a,b])roots(dot(normal,endpoint),normal[0]*endpoint[1]-normal[1]*endpoint[0],C);
    roots(cross(delta,p),dot(delta,p),cross(delta,a));
    roots(cross(delta,edge),dot(delta,edge),0);
  }
  const sorted=[...angles].sort((a,b)=>a-b),tests=[...sorted,...sorted.slice(1).map((v,i)=>(v+sorted[i])/2)];
  for(const angle of tests){
    const x=rotated(a,angle),y=rotated(b,angle);let low=0,high=1;
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],edge:Point=[q[0]-p[0],q[1]-p[1]],fa=cross(edge,[x[0]-p[0],x[1]-p[1]]),fb=cross(edge,[y[0]-p[0],y[1]-p[1]]);
      if(fa<0&&fb<0){low=1;high=0;break;}
      if(fa<0)low=Math.max(low,fa/(fa-fb));
      if(fb<0)high=Math.min(high,fa/(fa-fb));
    }
    if(high<=low)continue;
    const witness=point(x,y,(low+high)/2);
    if(poly.every((p,i)=>{const q=poly[(i+1)%poly.length];return cross([q[0]-p[0],q[1]-p[1]],[witness[0]-p[0],witness[1]-p[1]])>0;}))return witness;
  }
  return null;
}
/** Entire actual edge segment, including normal offset from the joint. */
function sweptHole(a:Point,b:Point,n:Point,joint:JointMaterial,piece:readonly PlacedArt[]):{found:number;required:number;at:Point}|null{
  const A:Point=[a[0]-joint.at[0],a[1]-joint.at[1]],B:Point=[b[0]-joint.at[0],b[1]-joint.at[1]],offset=dot(n,A),radius=Math.max(edgeLength(...A),edgeLength(...B));
  // A normal ray starts on the actual edge plane, not the joint plane.
  const bound=radius+Math.abs(offset);
  for(const [x,y,right,bottom] of emptyRectangles(joint.at,bound,piece)){
    const cell:Point[]=[[x-joint.at[0],y-joint.at[1]],[right-joint.at[0],y-joint.at[1]],[right-joint.at[0],bottom-joint.at[1]],[x-joint.at[0],bottom-joint.at[1]]];
    const outward=clip(cell,p=>offset-dot(n,p));if(polygonArea(outward)===0)continue;
    const distance=radius+Math.max(...outward.map(p=>edgeLength(...p)));
    const shadow=convexHull([...outward,...outward.map<Point>(p=>[p[0]-n[0]*distance,p[1]-n[1]*distance])]);
    const q=sweptSegmentWitness(A,B,shadow,joint.bend_degrees);if(q===null)continue;
    const required=offset-dot(n,q);if(required<=0)continue;
    const at:Point=[q[0]+joint.at[0],q[1]+joint.at[1]],start:Point=[at[0]+n[0]*required,at[1]+n[1]*required],found=support(piece,start,n);
    if(found<required)return {found,required,at};
    refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object:'swept source interval',detail:'a strict transparent-cell witness disagrees with its normal support reading; no PASS is inferred'}]);
  }
  return null;
}
export function materialRows(part: string, joint: JointMaterial | undefined, edges: readonly MaterialEdge[], source: readonly PlacedArt[], piece: readonly PlacedArt[]): MaterialRow[] {
  return edges.map(edge=>{
    const n=unit(edge.inward), d:Point=[edge.b[0]-edge.a[0],edge.b[1]-edge.a[1]], length=edgeLength(...d);
    let lo=0,hi=1;
    if(joint!==undefined){
      const q:Point=[edge.a[0]-joint.at[0],edge.a[1]-joint.at[1]], A=dot(d,d), B=2*dot(q,d), C=dot(q,q)-joint.reach_px**2, disc=B*B-4*A*C;
      if(A===0||disc<0){lo=1;hi=0;}else{lo=Math.max(0,(-B-Math.sqrt(disc))/(2*A));hi=Math.min(1,(-B+Math.sqrt(disc))/(2*A));}
    }
    if(!Number.isFinite(lo)||!Number.isFinite(hi)||!Number.isFinite(length))refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object:`part "${part}"`,detail:'joint/edge/reach arithmetic is not finite; supply representable measured stage coordinates and reach'}]);
    let crossed=0,found=Infinity,required=0,rays=0,fail=false,margin=Infinity;
    const spans=edge.opaque_t ?? opaqueParameters(edge,source);
    const intervals=spans.map(([a,b]):[Point,Point]=>[point(edge.a,edge.b,a),point(edge.a,edge.b,b)]);
    for(const interval of intervals){
      // Preserve the source pixel-cell partition; clipping changes its endpoints only.
      const param=(p:Point):number=>Math.abs(d[0])>=Math.abs(d[1])?(p[0]-edge.a[0])/d[0]:(p[1]-edge.a[1])/d[1];
      const from=Math.max(lo,param(interval[0])),to=Math.min(hi,param(interval[1]));
      if(to<=from)continue;
      if(joint!==undefined){
        const hole=sweptHole(point(edge.a,edge.b,from),point(edge.a,edge.b,to),n,joint,piece);
        if(hole!==null){fail=true;if(hole.found-hole.required<margin){margin=hole.found-hole.required;found=hole.found;required=hole.required;}}
      }
      const p=point(edge.a,edge.b,(from+to)/2);
      crossed+=(to-from)*length;rays++;
      const at=joint?.at??p,tangent:Point=[-n[1],n[0]],t=dot([p[0]-at[0],p[1]-at[1]],tangent);
      const offset=dot([p[0]-at[0],p[1]-at[1]],n);
      const angles=joint===undefined?[0]:[...joint.bend_degrees].map(a=>a*Math.PI/180);
      for(const angle of angles){
        const [cos,sin]=trig(angle),s=t*cos-offset*sin,start:Point=[at[0]+s*tangent[0]+offset*n[0],at[1]+s*tangent[1]+offset*n[1]];
        const r=joint===undefined?0:Math.max(0,offset*(1-cos)-t*sin),f=support(piece,start,n);
        if(!Number.isFinite(f)||!Number.isFinite(r))refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object:`part "${part}"`,detail:'material support arithmetic is not finite; no PASS is inferred'}]);
        if(f-r<margin || f-r===margin && r>required){margin=f-r;found=f;required=r;}
        if(f<r)fail=true;
      }
    }
    return {part,joint:joint?.joint??'(undeclared)',edge:[edge.a,edge.b],edge_length_px:intervals.reduce((s,[a,b])=>s+edgeLength(b[0]-a[0],b[1]-a[1]),0),within_reach_px:crossed,found_px:found===Infinity?0:found,required_px:required,rays,
      status:joint===undefined||rays===0?'SKIP':fail?'FAIL':'PASS',...(joint===undefined?{reason:'no declared cut_material requirement; measured source support is not a pass'}:rays===0?{reason:'no opaque source crossing within declared joint reach'}:{})};
  });
}
/** Original source intersections, represented as ordered bounded parameters. */
function opaqueParameters(edge:MaterialEdge,source:readonly PlacedArt[]):Array<[number,number]>{
  const ts=breaks(edge.a,edge.b,source),out:Array<[number,number]>=[];
  for(let i=0;i+1<ts.length;i++)if(across(source,point(edge.a,edge.b,(ts[i]+ts[i+1])/2),edge.inward))out.push([ts[i],ts[i+1]]);
  return out;
}
/** Canonical unit perpendicular; the sign is the explicitly captured inward side. */
export function canonicalInward(a:Point,b:Point,inward:Point):Point{
  const d:Point=[b[0]-a[0],b[1]-a[1]],length=edgeLength(...d),normal:Point=[-d[1]/length,d[0]/length];
  return dot(normal,inward)>0?normal:[-normal[0],-normal[1]];
}
export function materialSource(part:string,from:string[],edges:readonly MaterialEdge[],source:readonly PlacedArt[]):MaterialSource{
  return {part,from,source_sha256:source.map(s=>createHash('sha256').update(JSON.stringify([s.x,s.y,s.image.width,s.image.height])).update(s.image.data).digest('hex')),edges:edges.map(e=>{
    const inward=canonicalInward(e.a,e.b,e.inward),opaque_t=opaqueParameters({...e,inward},source),length=edgeLength(e.b[0]-e.a[0],e.b[1]-e.a[1]);
    return {a:e.a,b:e.b,inward,opaque_t,opaque_intervals:opaque_t.length,opaque_length_px:opaque_t.reduce((s,[a,b])=>s+(b-a)*length,0)};
  }).filter(e=>e.opaque_t.length>0)};
}
export function checkJointMaterial(declarations: readonly JointMaterial[] | undefined, parts: PartsFile | null, image: (name:string)=>Raster, problems:Problem[],sources?:readonly MaterialSource[]): MaterialLine {
  if(declarations===undefined)return {status:'SKIP',rows:[],reason:'no declared cut_material requirement'};
  refuseIfAny(jointMaterialProblems(declarations,'cut_material'));
  if(parts===null)refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object:'cut_material',detail:'requires parts.json and its emitted PNGs; missing art is not zero support'}]);
  const rows:MaterialRow[]=[];
  const records=(parts as PartsFile).parts;
  const art=(name:string):PlacedArt=>{const p=records.find(p=>p.name===name);if(p===undefined)throw new Error(`missing resolved part ${name}`);return {x:p.x,y:p.y,image:image(name)};};
  for(const req of declarations){
    const p=records.find(p=>p.name===req.part),object=`part "${req.part}", joint "${req.joint}"`;
    if(p===undefined||p.cut_from===undefined&&p.limb===undefined)refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object,detail:'requires a named cut_from or limb segment provenance; nearest parts and inferred joints are not read'}]);
    const rec=p!,limb=rec.limb;
    const original=sources?.find(s=>s.part===req.part);
    if(original===undefined)refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object,detail:'original source edge readings are unavailable; emitted siblings cannot reconstruct discarded/overlapping source art — rerun assemble --requirements <file> (or build --requirements <file>) to write the source-bound sidecar'}]);
    let piece=[art(rec.name)];
    if(limb!==undefined){
      if(limb.segment===0||limb.band!==undefined)refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object,detail:'requires a lower limb segment, not segment0 or the generated band'}]);
      const geometry=limb.cap??limb.hybrid;
      if(limb.joint!==req.joint||geometry===undefined||geometry.at[0]!==req.at[0]||geometry.at[1]!==req.at[1])refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object,detail:'declared joint name/at must equal the recorded lower joint centre; correct the explicit correspondence'}]);
      if(limb.hybrid!==undefined)piece=[...piece,art(limb.hybrid.part)];
    }
    const candidates=(original as MaterialSource).edges.filter(e=>(e.opaque_t??[]).some(([lo,hi])=>{
      const a=point(e.a,e.b,lo),b=point(e.a,e.b,hi),d:Point=[b[0]-a[0],b[1]-a[1]],q:Point=[req.at[0]-a[0],req.at[1]-a[1]],t=Math.max(0,Math.min(1,dot(q,d)/dot(d,d))),closest=point(a,b,t);return edgeLength(closest[0]-req.at[0],closest[1]-req.at[1])<=req.reach_px;
    }));
    if(candidates.length>0&&!candidates.some(e=>{
      const d:Point=[e.b[0]-e.a[0],e.b[1]-e.a[1]],perpendicular=dot(d,req.axis),side=cross(d,req.axis),captured=cross(d,e.inward),sameCanonical=cross(e.inward,req.axis);
      if(!Number.isFinite(perpendicular)||!Number.isFinite(side)||!Number.isFinite(captured)||!Number.isFinite(sameCanonical))refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object,detail:'edge/axis orientation arithmetic is not finite; supply a representable scalar multiple of the measured inward direction'}]);
      return (perpendicular===0||sameCanonical===0)&&side!==0&&Math.sign(side)===Math.sign(captured);
    }))refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object,detail:'declared axis matches no original opaque edge inward within reach; correct the explicit edge/joint correspondence'}]);
    const read=materialRows(req.part,req,(original as MaterialSource).edges,[],piece);
    if(read.every(r=>r.rays===0))refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object,detail:'no opaque cut interface within declared reach; correct the explicit joint correspondence/reach or supply source material; no PASS is invented'}]);
    for(const r of read.filter(r=>r.rays>0)){
      rows.push(r);
      if(r.status==='FAIL')problems.push({code:'CHECK_CUT_JOINT_MATERIAL',object,detail:`edge [${r.edge.map(p=>p.join(',')).join(' -> ')}], opaque edge length ${r.edge_length_px} px (${r.within_reach_px} px within reach): material found ${r.found_px} px, required ${r.required_px} px by bend [${req.bend_degrees.join(', ')}] degrees within reach ${req.reach_px} px; source art past the joint is required — follow AUTHORING Source before scissors; no crop or under-piece repair`});
    }
  }
  return {status:rows.some(r=>r.status==='FAIL')?'FAIL':'PASS',rows};
}
export function materialLines(line:MaterialLine):string[]{return [`${CUT_MATERIAL_LINE}: ${line.status}${line.reason===undefined?'':` — ${line.reason}`}`,...line.rows.map(r=>`${CUT_MATERIAL_LINE}: part "${r.part}", joint "${r.joint}", edge [${r.edge.map(p=>p.join(',')).join(' -> ')}]: ${r.status}; opaque edge length ${r.edge_length_px} px; material found ${r.found_px} px, required ${r.required_px} px (${r.rays} source rays; continuous inverse-rotation arc)`)];}
