/** Opt-in source-only displacement, constrained adaptive meshes; no rigid turn. */
import { computeWorldTransforms, toWorld, toBoneLocal, toBoneLocalVector } from './coords.ts';
import { pyRound } from './round.ts';
import { regionCorners } from 'rig-c/src/core/vertices.ts';
import { DEPTH_EYE_CHECK_LABEL, depthRefuse, insideDepthTriangle, sampleDepth, type PreparedDepth } from './depthinput.ts';
import { constrainDepthMesh, depthUV, locateDepthUV, indexDepthUV, refineDepthMesh, DepthLeastSquares, type DepthLinear, type DepthHalfspace, type DepthSolveReport, type DepthMeshResult, type DepthUV, type DepthSample } from './depthmesh.ts';
import { coverageConstraints, depthAlpha, type CoverageSurface, type CoverageConstraints, type CoverageFallback } from './depthcoverage.ts';
import type { SurfaceRig, SliderAnimation, SliderTrack, DeformMeshAttachment } from './turn.ts';

export interface DepthError { samples: number; rms: number | null; max: number | null; }
export interface DepthReport {
  pilot?: { label: typeof DEPTH_EYE_CHECK_LABEL; mode: 'mixed-alpha-final-coverer'; shippable: false; fallbackCells: CoverageFallback[]; fallbackCount: number; sourceArea: number; sourceTexelArea: number };
  approximation?: DepthSolveReport & { sourceBoundRange: number; label: string };
  input: string;
  projection: 'depth-displacement';
  regions: Array<{ part: string; beforeVertices: number; vertices: number; beforeTriangles: number; triangles: number; budget: number; exhausted: boolean; continued: number; maxContinuation: number; denseSamples: number; depthRms: number | null; depthMax: number | null; rawDepthRms: number | null; rawDepthMax: number | null; rawSourceCore: DepthError; rawContinuedBoundary: DepthError; rawNeutralVisible: DepthError; rawNeutralProtected: DepthError; rawCarried: DepthError; neutralVisibility: string; neutralProtection: string; rejectedSplits: DepthMeshResult['rejectedSplits']; reliefRetention: number | null; emittedZ: number[]; coreFidelity: { samples: number; sourceArea: number; rms: number | null; centeredRmsRetention: number | null; covarianceScale: number | null } }>;
  coverage: Array<{ subject: string; coverer: string; kind: 'host-support' | 'covering-ownership'; protectedTexels: number; dependencyAlphaTexels?: number; carriedCells: number }>;
  modelSpacePoses: number;
  modelSpaceFolds: number;
  pending: string[];
  composition: string;
}
export function depthZ(value: number, model: PreparedDepth['manifest']['model'], polarity: PreparedDepth['manifest']['source']['polarity'], reference: number): number {
  const near = polarity === 'white-near' ? value : 1 - value, ref = polarity === 'white-near' ? reference : 1 - reference;
  return model.reliefGain * (near ** model.gamma - ref ** model.gamma);
}
export function projectDepth(x: number, y: number, z: number, yaw: number, pitch: number): [number, number] {
  if ((yaw === 0 && pitch === 0) || z === 0) return [x, y];
  return [x + z * Math.sin(yaw * Math.PI / 180), y + z * Math.sin(pitch * Math.PI / 180)];
}
/** Same source/export rounding reserve before optional admission and final fit. */
export function depthRoundingReserve(p: readonly DepthUV[], error: number, sx: number, sy: number): number {
  const [a,b,c]=p,d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const edge=(u:DepthUV,v:DepthUV):number=>Math.abs(v[0]-u[0])+Math.abs(v[1]-u[1])+(sx+sy)*Math.max(sx?Math.abs(v[0]-u[0])/sx:0,sy?Math.abs(v[1]-u[1])/sy:0);
  return (2*error*(edge(a,b)+edge(a,c))+8*error*error)/Math.abs(d);
}
export function applyDepthSurface(rig: SurfaceRig, motion: { groups?: Record<string, string[]>; animations: Record<string, unknown> }, input: PreparedDepth, bands: { yaw: number; pitch: number }): DepthReport {
  const { manifest, fields } = input, model = manifest.model, frames = computeWorldTransforms(rig.bones), pivot = frames.get(model.pivotBone);
  if (!pivot) return depthRefuse('RIG_DEPTH_BINDING', model.pivotBone, 'declared neutral pivot frame is absent');
  if (!Number.isFinite(pivot.a * pivot.d - pivot.b * pivot.c) || pivot.a * pivot.d - pivot.b * pivot.c === 0) return depthRefuse('RIG_DEPTH_BINDING', model.pivotBone, 'a finite invertible neutral pivot frame is required');
  const bones = new Map(rig.bones.map(b => [b.name, b]));
  const report: DepthReport = { input: input.digest, projection: 'depth-displacement', regions: [], coverage: [], modelSpacePoses: 0, modelSpaceFolds: 0, pending: ['actual compiled neutral pixels and combined-pose folds', 'posed coverage exposure and owner live check', 'actual packed-page neutral alpha classification conformance'], composition: 'Source-only Z*sin(view) displacement. One declared source-field reference; no layer constants, cosine contraction, global head rotation or shared bone tangent. Independent additive axis deforms; slopes, ordering and ratios are reported, not gated.' };
  if (manifest.pilot) {
    if (manifest.pilot.mode !== 'mixed-alpha-final-coverer' || manifest.pilot.label !== DEPTH_EYE_CHECK_LABEL) depthRefuse('RIG_DEPTH_PILOT', 'depth.pilot', 'exact explicit pilot annotation required');
    report.pilot = { ...manifest.pilot, shippable: false, fallbackCells: [], fallbackCount: 0, sourceArea: 0, sourceTexelArea: 0 };
    report.pending.unshift(DEPTH_EYE_CHECK_LABEL);
  }
  // Preserve partial source/count diagnostics on a named refusal; pending
  // gates and zero pose counts prevent this from implying an accepted output.
  Object.assign(input.report, report);
  const owned = new Set<string>();
  const addOwner = (name: string): void => { let current: string | undefined = name; while (current) { if (owned.has(current)) break; owned.add(current); if (current === model.pivotBone) break; current = bones.get(current)?.parent; } };
  for (const [part, binding] of Object.entries(manifest.bindings)) {
    const slot = rig.slots?.find(s => s.name === part), att = rig.skins.default[part]?.[part];
    if (!slot || !att) return depthRefuse('RIG_DEPTH_BINDING', part, 'target slot/attachment is absent');
    addOwner(slot.bone);
    if ('type' in att) for (const weights of att.weights) for (const w of weights) addOwner(w.bone);

  }
  for (const name of owned) { const b = bones.get(name); if (b?.inherit !== undefined && b.inherit !== 'normal') return depthRefuse('RIG_DEPTH_BINDING', name, 'source-only mesh baking currently requires normal inheritance on managed ancestry; provide a supported frame'); }
  for (const [group, members] of Object.entries(manifest.groups)) {
    for (const member of members) if (!bones.has(member)) return depthRefuse('RIG_DEPTH_BINDING', group, `declared control group member ${member} is absent`);
    if (motion.groups?.[group] && motion.groups[group].join('\0') !== members.join('\0')) return depthRefuse('RIG_DEPTH_BINDING', group, 'manifest and motion group membership disagree');
  }
  const controls = new Map<'yaw' | 'pitch', { anim: SliderAnimation; keys: Array<{ t: number; deg: number }>; remove: Set<SliderTrack> }>();
  for (const [name, axis] of [['turn', 'yaw'], ['tilt', 'pitch']] as const) {
    const anim = motion.animations[name] as SliderAnimation | undefined;
    if (!anim || !Array.isArray(anim.tracks) || !Number.isFinite(anim.duration) || !(anim.duration > 0)) return depthRefuse('RIG_DEPTH_BINDING', name, 'both finite turn/tilt control timelines are required');
    const remove = new Set<SliderTrack>(); let schedule: Array<{ t: number; deg: number }> | undefined;
    for (const track of anim.tracks) {
      if (!Array.isArray(track.keys)) return depthRefuse('RIG_DEPTH_BINDING', name, 'each control track must hold keys');
      const derives = track.keys.some(k => k.derive !== undefined);
      const members = track.bone ? [track.bone] : track.group ? (motion.groups?.[track.group] ?? manifest.groups[track.group]) : undefined;
      if (!members || !members.length || members.some(n => !bones.has(n))) return depthRefuse('RIG_DEPTH_BINDING', name, 'every control track bone/group must resolve explicitly');
      if (!derives) { if (members.some(n => owned.has(n))) return depthRefuse('RIG_DEPTH_BINDING', name, 'a non-derived track also drives a managed surface; declare one owner'); continue; }
      if (members.some(n => !owned.has(n))) return depthRefuse('RIG_DEPTH_BINDING', name, 'mixed/unmanaged derive targets cannot be discarded; split the controls or bind every driven surface');
      if (!['translatex', 'translatey', 'scalex', 'scaley'].includes(track.property)) return depthRefuse('RIG_DEPTH_BINDING', name, 'only declared translation/scale derive tracks can migrate to the depth surface');
      const keys: Array<{ t: number; deg: number }> = [];
      for (const k of track.keys) {
        if (!Number.isFinite(k.t) || k.t < 0 || k.t > anim.duration || (keys.length && k.t <= keys[keys.length - 1].t)) return depthRefuse('RIG_DEPTH_BINDING', name, 'control times must be finite, ordered, unique and inside duration');
        let deg: number;
        if (k.derive !== undefined) {
          if (k.derive.kind !== axis || !Number.isFinite(k.derive.degrees)) return depthRefuse('RIG_DEPTH_BINDING', name, 'every derive kind and degree must match its control axis');
          deg = k.derive.degrees;
        } else {
          const neutral = track.property.startsWith('scale') ? 1 : 0;
          const values = Array.isArray(k.v) ? [k.v] : k.v && typeof k.v === 'object' && Object.keys(k.v).length === members.length && members.every(n => Object.hasOwn(k.v as Record<string, number[]>, n)) ? Object.values(k.v) : [];
          if (!values.length || values.some(v => !Array.isArray(v) || v.length !== 1 || v[0] !== neutral)) return depthRefuse('RIG_DEPTH_BINDING', name, 'a non-derived key must explicitly state the neutral value for every member');
          deg = 0;
        }
        if (Math.abs(deg) > bands[axis]) return depthRefuse('RIG_DEPTH_BINDING', name, 'derive degrees exceed the declared supported band');
        keys.push({ t: k.t, deg });
      }
      if (keys.length < 3 || keys[0].t !== 0 || keys[keys.length - 1].t !== anim.duration || !keys.some(k => k.deg === 0)) return depthRefuse('RIG_DEPTH_BINDING', name, 'control must span duration and include an explicit neutral key');
      if (schedule && JSON.stringify(schedule) !== JSON.stringify(keys)) return depthRefuse('RIG_DEPTH_BINDING', name, 'derive tracks disagree on time/degree schedule; no arbitrary first track can define the surface');
      schedule = keys; remove.add(track);
    }
    if (!schedule) return depthRefuse('RIG_DEPTH_BINDING', name, 'explicit derived control schedule is required');
    controls.set(axis, { anim, keys: schedule, remove });
  }
  // These six-channel timelines describe additive axis deltas. A replacing or
  // partially mixed runtime slider would apply a different model to the keys.
  const dialBones = new Set<string>();
  for (const [name, axis] of [['turn', 'yaw'], ['tilt', 'pitch']] as const) {
    const sliders = (rig.constraints ?? []).filter(c => c.type === 'slider' && c.animation === name);
    if (sliders.length !== 1) return depthRefuse('RIG_DEPTH_BINDING', name, `found ${sliders.length} runtime sliders; exactly one explicit slider per depth axis is required`);
    const c = sliders[0], at = `depth ${axis} slider ${String(c.name)}`;
    if (c.additive !== true || c.mix !== 1 || c.skin === true || c.time !== undefined || (c.loop !== undefined && c.loop !== false)) return depthRefuse('RIG_DEPTH_BINDING', at, 'additive:true, mix:1, unskinned bone-driven and nonlooping playback are required; replacing or partially mixed sliders do not compose the depth model');
    if (typeof c.bone !== 'string' || !bones.has(c.bone) || dialBones.has(c.bone) || owned.has(c.bone) || c.property !== 'rotate' || c.local !== true) return depthRefuse('RIG_DEPTH_BINDING', at, 'distinct existing unmanaged dial bones with property:rotate and local:true are required for signed axis degrees');
    dialBones.add(c.bone);
    if (typeof c.from !== 'number' || !Number.isFinite(c.from) || typeof c.to !== 'number' || !Number.isFinite(c.to) || typeof c.scale !== 'number' || !Number.isFinite(c.scale) || !(c.scale > 0)) return depthRefuse('RIG_DEPTH_BINDING', at, 'explicit finite from/to and positive scale must map signed dial degrees to control time');
    const keys = controls.get(axis)?.keys;
    if (!keys || keys.some(k => Math.abs((k.deg - (c.from as number)) * (c.scale as number) + (c.to as number) - k.t) > 1e-8)) return depthRefuse('RIG_DEPTH_BINDING', at, 'slider degree-to-time mapping disagrees with the declared control schedule, including zero; no axis gain or sign is inferred');
  }
  if (model.reliefGain === 0) {
    for (const control of controls.values()) control.anim.tracks = control.anim.tracks.filter(t => !control.remove.has(t));
    report.composition += ' Explicit zero gain bypassed all topology/geometry edits; no model-space pose checks were run.';
    return report;
  }
  for (const name of ['turn', 'tilt']) { const anim = motion.animations[name] as SliderAnimation; if (anim.deform?.some(d => manifest.bindings[d.slot])) return depthRefuse('RIG_DEPTH_BINDING', name, 'an authored deform conflicts with the managed source-only field'); }
  const original = new Map<string, DeformMeshAttachment>(), setup = (att: DeformMeshAttachment): DepthUV[] => att.weights.map(row => {
    const p: DepthUV = [0, 0];
    for (const w of row) { const f = frames.get(w.bone); if (!f || f.a * f.d - f.b * f.c === 0) return depthRefuse('RIG_DEPTH_BINDING', w.bone, 'an invertible actual setup weight frame is required'); const world = toWorld(f, w.x, w.y), q = toBoneLocal(pivot, ...world); p[0] += w.weight * q[0]; p[1] += w.weight * q[1]; }
    return p;
  });
  for (const [part, binding] of Object.entries(manifest.bindings)) {
    const att = rig.skins.default[part][part], slot = rig.slots?.find(s => s.name === part);
    if (!slot) return depthRefuse('RIG_DEPTH_BINDING', part, 'bound slot is absent');
    if ('type' in att) { original.set(part, structuredClone(att)); continue; }
    const [,, width, height] = binding.bounds, source = fields.get(part)?.geometry;
    const geometry = source ?? { uvs: [0, 1, 0, 0, 1, 0, 1, 1], triangles: [0, 1, 2, 0, 2, 3], hull: 4 };
    const identity = { a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }, corners = regionCorners({ ...att, width, height, atlas: { width, height, originalWidth: width, originalHeight: height, offsetX: 0, offsetY: 0 } }, identity);
    const regionUV = [0, 1, 0, 0, 1, 0, 1, 1], weights = Array.from({ length: geometry.uvs.length / 2 }, (_, i) => {
      const uv: DepthUV = [geometry.uvs[i * 2], geometry.uvs[i * 2 + 1]];
      let point: DepthUV | undefined;
      for (const ids of [[0, 1, 2], [0, 2, 3]]) { const w = insideDepthTriangle(...uv, regionUV, ids, 1, 1); if (w) { point = [0, 1].map(k => ids.reduce((s, id, j) => s + corners[id * 2 + k] * w[j], 0)) as DepthUV; break; } }
      if (!point) return depthRefuse('RIG_DEPTH_BINDING', part, 'source mesh UV lies outside its declared region quad');
      return [{ bone: slot.bone, x: point[0], y: point[1], weight: 1 }];
    });
    original.set(part, { type: 'mesh', image: att.image, width, height, ...geometry, uvs: [...geometry.uvs], triangles: [...geometry.triangles], weights });
  }
  // Reject unowned yaw/pitch rotations along a managed ancestry; roll and other
  // animations remain in their own lane. No layer fields are read here.
  for (const [name] of [['turn'], ['tilt']]) {
    const anim = motion.animations[name] as SliderAnimation;
    for (const track of anim.tracks) if (!controls.get(name === 'turn' ? 'yaw' : 'pitch')?.remove.has(track)) {
      const members = track.bone ? [track.bone] : track.group ? motion.groups?.[track.group] ?? manifest.groups[track.group] : [];
      if (members?.some(n => owned.has(n))) return depthRefuse('RIG_DEPTH_BINDING', name, 'another yaw/pitch track drives the managed ancestry; source-only ownership is required');
    }
  }
  const owners = new Map<string, string>();
  for (const pair of manifest.coverage.overlaps) {
    const a = rig.slots?.findIndex(s => s.name === pair.subject) ?? -1, b = rig.slots?.findIndex(s => s.name === pair.coverer) ?? -1;
    if (a < 0 || b <= a || !original.has(pair.subject) || !original.has(pair.coverer) || owners.has(pair.subject)) return depthRefuse('RIG_DEPTH_COVERAGE', pair.subject, 'one explicitly bound later covering owner is required; duplicate/ambiguous owners and wrong draw order refuse');
    owners.set(pair.subject, pair.coverer);
  }
  const surfaces = new Map<string, CoverageSurface>(), active = new Set<string>();
  const coupling = new Map<string, { owner: string; constraints: CoverageConstraints }>();
  type RawRow = { raw: number; continued: number; protected: boolean; carried: boolean; visible: boolean };
  const provenance = new Map<string, { samples: DepthSample[]; rows: RawRow[]; refined: DepthMeshResult; continued: number; maxContinuation: number; visibilityKnown: boolean }>();
  const triangleArea = (points: DepthUV[], ids: readonly number[]): number => { const [a, b, c] = ids; return (points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) - (points[b][1] - points[a][1]) * (points[c][0] - points[a][0]); };
  const sx=Math.abs(Math.sin(bands.yaw*Math.PI/180)),sy=Math.abs(Math.sin(bands.pitch*Math.PI/180));
  const sourceBoundRange=[...fields.values()].reduce((m,f)=>Math.max(m,Math.abs(depthZ(0,model,manifest.source.polarity,f.reference)),Math.abs(depthZ(1,model,manifest.source.polarity,f.reference))),0);
  const vertexError = (mesh: DeformMeshAttachment, i: number): number => {
    if (sourceBoundRange === 0) return 0;
    let error = 0;
    for (const w of mesh.weights[i]) {
      const f = frames.get(w.bone)!;
      const localYaw = toBoneLocalVector(f, pivot.a * sx, pivot.c * sx), localPitch = toBoneLocalVector(f, pivot.b * sy, pivot.d * sy);
      const localMagnitude = sourceBoundRange * (Math.abs(localYaw[0]) + Math.abs(localYaw[1]) + Math.abs(localPitch[0]) + Math.abs(localPitch[1]));
      const localError = 0.0001 + 2 ** -24 * (localMagnitude + 0.0001);
      const x = toBoneLocalVector(pivot, f.a, f.c), y = toBoneLocalVector(pivot, f.b, f.d);
      error += Math.abs(Math.fround(w.weight)) * Math.max(Math.abs(x[0]) + Math.abs(y[0]), Math.abs(x[1]) + Math.abs(y[1])) * localError;
    }
    return error + 64 * Number.EPSILON * (1 + sourceBoundRange);
  };
  // Actual consumer storage precision: core/vertices.ts reads binding pairs and
  // weights through Math.fround. Bone frames use the same setup transform reader.
  const exportedSetup = (mesh: DeformMeshAttachment): DepthUV[] => mesh.weights.map(row => {
    const p: DepthUV = [0, 0];
    for (const w of row) { const f = frames.get(w.bone); if (!f) return depthRefuse('RIG_DEPTH_BINDING', w.bone, 'export weight frame absent'); const q = toBoneLocal(pivot, ...toWorld(f, Math.fround(w.x), Math.fround(w.y))), weight = Math.fround(w.weight); p[0] += weight * q[0]; p[1] += weight * q[1]; }
    return p;
  });
  const eligibility = (seed: DeformMeshAttachment): ((mesh: DeformMeshAttachment, children: readonly number[][]) => string | null) => {
    const base = exportedSetup(seed), sign = Math.sign(triangleArea(base, seed.triangles.slice(0, 3))), uvPoints = Array.from({ length: seed.weights.length }, (_, i) => depthUV(seed, i)), uvSign = Math.sign(triangleArea(uvPoints, seed.triangles.slice(0, 3)));
    return (mesh, children) => {
      const p = exportedSetup(mesh), uv = Array.from({ length: mesh.weights.length }, (_, i) => [Math.fround(mesh.uvs[i * 2]), Math.fround(mesh.uvs[i * 2 + 1])] as DepthUV);
      for (const ids of children) { const a = triangleArea(p, ids), u = triangleArea(uv, ids); if (!Number.isFinite(a) || !Number.isFinite(u) || !(a * sign > 0) || !(u * uvSign > 0)) return 'child neutral world/UV orientation collapses or reverses at Float32 export precision'; const reserve=depthRoundingReserve(ids.map(i=>p[i]),Math.max(...ids.map(i=>vertexError(mesh,i))),sx,sy); if(!(reserve<1))return `child export-rounding determinant reserve ${reserve} is not below1`; }
      return null;
    };
  };
  const originalPoints = new Map([...original].map(([name, mesh]) => [name, setup(mesh)]));
  const rawQuery = (part: string, uv: DepthUV): { z: number; continued: number } => {
    const binding = manifest.bindings[part]; let sourceUV = uv; const host = binding.host ?? part, field = fields.get(host);
    if (!field) return depthRefuse('RIG_DEPTH_BINDING', host, 'a declared nonempty direct field is required');
    if (binding.host) {
      const seed = original.get(part) as DeformMeshAttachment, hit = locateDepthUV(seed, uv); if (!hit) return depthRefuse('RIG_DEPTH_BINDING', part, 'follower query is outside its original material domain');
      const p: DepthUV = [0, 1].map(k => hit.ids.reduce((s, id, j) => s + (originalPoints.get(part) as DepthUV[])[id][k] * hit.w[j], 0)) as DepthUV;
      const hostMesh = original.get(host) as DeformMeshAttachment, hostXY = (originalPoints.get(host) as DepthUV[]).flat(); let found = false;
      for (let t = 0; t < hostMesh.triangles.length; t += 3) { const ids = hostMesh.triangles.slice(t, t + 3), w = insideDepthTriangle(...p, hostXY, ids, 1, 1); if (w) { sourceUV = [0, 1].map(k => ids.reduce((s, id, j) => s + hostMesh.uvs[id * 2 + k] * w[j], 0)) as DepthUV; found = true; break; } }
      if (!found) return depthRefuse('RIG_DEPTH_SAMPLE_UNSUPPORTED', part, 'promoted follower material is outside its original host mesh; no relocated anchor or extrapolated UV is inferred');
    }
    const sample = sampleDepth(field, ...sourceUV, manifest.sampling.continuation);
    return { z: depthZ(sample.value, model, manifest.source.polarity, field.reference), continued: sample.continued };
  };
  const neutralAlpha = (part: string, point: DepthUV): number => {
    const mesh = original.get(part), image = input.images.get(part), points = originalPoints.get(part); if (!mesh || !image || !points) return 0;
    let alpha = 0;
    for (let t = 0; t < mesh.triangles.length; t += 3) { const ids = mesh.triangles.slice(t, t + 3), w = insideDepthTriangle(...point, points.flat(), ids, 1, 1); if (w) { const uv: DepthUV = [0, 1].map(k => ids.reduce((s, id, j) => s + mesh.uvs[id * 2 + k] * w[j], 0)) as DepthUV; alpha = Math.max(alpha, depthAlpha(image, uv)); } }
    return alpha;
  };
  const prepare = (part: string): CoverageSurface => {
    const done = surfaces.get(part); if (done) return done;
    if (active.has(part)) return depthRefuse('RIG_DEPTH_COVERAGE', part, 'covering ownership contains a cycle'); active.add(part);
    const seed = original.get(part) as DeformMeshAttachment, binding = manifest.bindings[part], image = input.images.get(part);
    if (!image) return depthRefuse('RIG_DEPTH_BINDING', part, 'source-bound target RGBA is absent');
    const coverer = binding.host ?? owners.get(part), constraints = coverer ? coverageConstraints({ mesh: seed, points: exportedSetup(seed), z: [], image }, prepare(coverer), manifest.coverage.alphaMin, binding.host !== undefined, manifest.pilot) : undefined;
    if (constraints && coverer) coupling.set(part, { owner: coverer, constraints });
    if (constraints && report.pilot) {
      report.pilot.fallbackCells.push(...constraints.fallbacks); report.pilot.fallbackCount += constraints.fallbacks.length;
      report.pilot.sourceArea += constraints.fallbacks.reduce((n, c) => n + c.sourceArea, 0);
      report.pilot.sourceTexelArea += constraints.fallbacks.reduce((n, c) => n + c.sourceTexelArea, 0);
    }
    if (constraints) report.coverage.push({ subject: part, coverer: coverer as string, kind: binding.host ? 'host-support' : 'covering-ownership', protectedTexels: binding.host ? 0 : constraints.protectedTexels, ...(binding.host ? { dependencyAlphaTexels: constraints.protectedTexels } : {}), carriedCells: constraints.carriedCells });
    const query = (uv: DepthUV): number => constraints?.value(uv) ?? rawQuery(part, uv).z;
    const constrained = constraints?.carriedCells ? constrainDepthMesh(seed, constraints.cells, binding.triangles, constraints.exact) : seed;
    const samples: DepthSample[] = [], sourceRows: RawRow[] = [];
    const slotIndex = rig.slots?.findIndex(s => s.name === part) ?? -1, later = rig.slots?.slice(slotIndex + 1).map(s => s.name) ?? [], visibilityKnown = later.every(n => original.has(n) && input.images.has(n));
    if (model.reliefGain !== 0) for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] < manifest.sampling.alphaMin) continue;
      const uv: DepthUV = [(x + 0.5) / image.width, (y + 0.5) / image.height]; const hit = locateDepthUV(seed, uv);
      if (hit) {
        const raw = rawQuery(part, uv), carried = constraints?.value(uv), p: DepthUV = [0, 1].map(k => hit.ids.reduce((s, id, j) => s + (originalPoints.get(part) as DepthUV[])[id][k] * hit.w[j], 0)) as DepthUV;
        let transmittance = 1; if (visibilityKnown) for (const other of later) transmittance *= 1 - neutralAlpha(other, p);
        const visible = visibilityKnown && depthAlpha(image, uv) * transmittance * 255 >= manifest.coverage.alphaMin;
        const physicalOwner=owners.get(part),physicalProtected=physicalOwner!==undefined&&depthAlpha(image,uv)*255>=manifest.coverage.alphaMin&&neutralAlpha(physicalOwner,p)*255>=manifest.coverage.alphaMin;
        samples.push({ uv, z: carried ?? raw.z }); sourceRows.push({ raw: raw.z, continued: raw.continued, protected: physicalProtected, carried: carried !== null && carried !== undefined, visible });
      }
    }
    const refined = refineDepthMesh(constrained, samples, query, binding.triangles, undefined, eligibility(seed));
    const mesh = refined.mesh, points = exportedSetup(mesh), z = mesh.weights.map((_, i) => model.reliefGain === 0 ? 0 : query(depthUV(mesh, i))); let continued = 0, maxContinuation = 0, rawSquare = 0, rawMax = 0;
    for (let i = 0; i < mesh.weights.length && model.reliefGain !== 0; i++) { const raw = rawQuery(part, depthUV(mesh, i)); if (raw.continued) continued++; maxContinuation = Math.max(maxContinuation, raw.continued); }
    provenance.set(part, { samples, rows: sourceRows, refined, continued, maxContinuation, visibilityKnown });
    const surface = { mesh, points, z, image }; surfaces.set(part, surface); active.delete(part); return surface;
  };
  for (const part of Object.keys(manifest.bindings)) prepare(part);
  // Shared/carry vertices are exact expressions of FINAL host/cover fields.
  const expressions = new Map<string, DepthLinear>(), resolving = new Set<string>(); let variables = 0;
  const combine = (terms: Array<{ row: DepthLinear; factor: number }>): DepthLinear => {
    const sums = new Map<number, number>(); for (const { row, factor } of terms) row.ids.forEach((id, i) => sums.set(id, (sums.get(id) ?? 0) + factor * row.values[i]));
    const entries = [...sums].filter(([, value]) => value !== 0).sort(([a], [b]) => a - b); return { ids: entries.map(([i]) => i), values: entries.map(([, v]) => v) };
  };
  const expression = (part: string, i: number): DepthLinear => {
    const key = `${part}:${i}`, prior = expressions.get(key); if (prior) return prior;
    if (resolving.has(key)) return depthRefuse('RIG_DEPTH_COVERAGE', part, 'cyclic final-field vertex ownership'); resolving.add(key);
    const c = coupling.get(part), row = surfaces.get(part)!, hit = c?.constraints.ownerAt(depthUV(row.mesh, i));
    if (manifest.bindings[part].host && !hit) return depthRefuse('RIG_DEPTH_SAMPLE_UNSUPPORTED', part, 'final host partition does not support a material vertex');
    const value = c && hit ? combine(hit.ids.map((id, k) => ({ row: expression(c.owner, id), factor: hit.w[k] }))) : { ids: [variables++], values: [1] };
    expressions.set(key, value); resolving.delete(key); return value;
  };
  for (const [part, row] of surfaces) row.mesh.weights.forEach((_, i) => expression(part, i));
  const objective = new DepthLeastSquares(variables), coreAreas = new Map<string, Float64Array>(), materialIndices = new Map<string, ReturnType<typeof indexDepthUV>>();
  for (const [part, field] of fields) {
    const surface = surfaces.get(part); if (!surface) return depthRefuse('RIG_DEPTH_BINDING', part, 'sampled field has no surface');
    const originalMesh = original.get(part)!, points = originalPoints.get(part)!, uvPoints = Array.from({ length: originalMesh.weights.length }, (_, j) => depthUV(originalMesh, j)), hitMaterial = indexDepthUV(surface.mesh), hitSource = indexDepthUV(originalMesh);
    const areas = new Float64Array(field.valid.length); coreAreas.set(part, areas); materialIndices.set(part, hitMaterial); let sampleIndex = 0;
    for (const i of field.valid) {
      const uv: DepthUV = [(i % field.width + 0.5) / field.width, (Math.floor(i / field.width) + 0.5) / field.height], hit = hitMaterial(uv), source = hitSource(uv);
      if (!hit || !source) return depthRefuse('RIG_DEPTH_FIELD_SAMPLE', part, `owned core sample ${i} is outside the represented material domain`);
      const uvArea = triangleArea(uvPoints, source.ids), physicalArea = triangleArea(points, source.ids), area = Math.abs(physicalArea / uvArea) / field.width / field.height;
      const target = depthZ(field.values[i], model, manifest.source.polarity, field.reference);
      areas[sampleIndex++] = area;
      objective.add(combine(hit.ids.map((id, k) => ({ row: expression(part, id), factor: hit.w[k] }))), target, area);
    }
  }
  const spaces: DepthHalfspace[] = [];
  // The already-declared symmetric source/export certificate is part of the
  // convex feasible set, not a post-fit clipping or reject-only mechanism.
  for (const [part,row] of surfaces) for(let i=0;i<row.mesh.weights.length;i++) {
    const e=expression(part,i);
    for(const sign of [-1,1]) spaces.push({ids:e.ids,values:e.values.map(v=>sign*v),upper:sourceBoundRange,object:`${part} vertex ${i} declared symmetric source envelope`});
  }
  for (const [part, row] of surfaces) for (let t = 0; t < row.mesh.triangles.length; t += 3) {
    const ids = row.mesh.triangles.slice(t, t + 3), p = ids.map(i => row.points[i]), d = triangleArea(row.points, ids);
    if (!Number.isFinite(d) || d === 0) return depthRefuse('RIG_DEPTH_MESH_PRECISION', part, `neutral triangle ${t / 3} is not representable`);
    const gx = [(p[1][1] - p[2][1]) / d, (p[2][1] - p[0][1]) / d, (p[0][1] - p[1][1]) / d], gy = [(p[2][0] - p[1][0]) / d, (p[0][0] - p[2][0]) / d, (p[1][0] - p[0][0]) / d];
    const reserve = depthRoundingReserve(p, Math.max(...ids.map(i => vertexError(row.mesh,i))), sx, sy);
    if (!(reserve < 1)) return depthRefuse('RIG_DEPTH_FIELD_PRECISION', part, `triangle ${t / 3} cannot certify export rounding; required determinant reserve ${reserve}`);
    for (const a of [-sx, sx]) for (const b of [-sy, sy]) {
      const value = combine(ids.map((id, k) => ({ row: expression(part, id), factor: a * gx[k] + b * gy[k] })));
      if (value.values.some(v => v !== 0)) spaces.push({ ...value, upper: 1 - reserve, object: `${part} triangle ${t / 3}` });
    }
  }
  const solved = objective.solve(spaces);
  report.approximation = { ...solved.report, sourceBoundRange, label: 'source-only coupled constrained approximation; RAW fidelity/relief retention reported, not gated' };
  for (const [part, row] of surfaces) row.z = row.mesh.weights.map((_, i) => { const e = expression(part, i); return e.ids.reduce((s, id, k) => s + solved.values[id] * e.values[k], 0); });
  // Constraints reference the same surface objects, whose z arrays now hold the
  // final joint solution rather than the earlier source-target interpolation.
  for (const [part, row] of surfaces) {
    if (row.z.some(z => Math.abs(z) > sourceBoundRange + 2 ** -30 * (1 + sourceBoundRange))) return depthRefuse('RIG_DEPTH_FIELD_PRECISION', part, 'solved field exceeds the authored source-range precision certificate; no clipping');
    const q = provenance.get(part)!, errors = { core: [] as number[], continued: [] as number[], visible: [] as number[], protected: [] as number[], carried: [] as number[] }, actualCore: number[] = [], rawCore: number[] = []; let effectiveSquare = 0, effectiveMax = 0;
    q.samples.forEach((s, i) => {
      const hit = locateDepthUV(row.mesh, s.uv)!; const value = hit.ids.reduce((v, id, k) => v + row.z[id] * hit.w[k], 0), raw = q.rows[i], error = Math.abs(value - raw.raw), owner = coupling.get(part)?.constraints.value(s.uv), target = owner ?? raw.raw;
      effectiveSquare += (value - target) ** 2; effectiveMax = Math.max(effectiveMax, Math.abs(value - target));
      errors[raw.continued === 0 ? 'core' : 'continued'].push(error); if (raw.visible) errors.visible.push(error); if (raw.protected) errors.protected.push(error); if (raw.carried) errors.carried.push(error);
      if (raw.continued === 0) { actualCore.push(value); rawCore.push(raw.raw); }
    });
    const summary = (values: number[]): DepthError => ({ samples: values.length, rms: values.length ? Math.sqrt(values.reduce((s, e) => s + e * e, 0) / values.length) : null, max: values.length ? values.reduce((s, e) => Math.max(s, e), 0) : null });
    let areaSum = 0, rawMean = 0, fitMean = 0, rawVariance = 0, fitVariance = 0, covariance = 0, weightedError = 0;
    const ownField = fields.get(part), areas = coreAreas.get(part), hitCore = materialIndices.get(part), flat = row.z.every(z => z === row.z[0]);
    if (ownField && areas && hitCore) ownField.valid.forEach((i, k) => {
      const uv: DepthUV = [(i % ownField.width + 0.5) / ownField.width, (Math.floor(i / ownField.width) + 0.5) / ownField.height], hit = hitCore(uv)!;
      const raw = depthZ(ownField.values[i], model, manifest.source.polarity, ownField.reference), fitted = flat ? row.z[0] : hit.ids.reduce((s, id, j) => s + row.z[id] * hit.w[j], 0), weight = areas[k], next = areaSum + weight, dr = raw - rawMean, df = fitted - fitMean;
      rawMean += weight * dr / next; fitMean += weight * df / next;
      rawVariance += weight * dr * (raw - rawMean); fitVariance += weight * df * (fitted - fitMean); covariance += weight * dr * (fitted - fitMean); weightedError += weight * (fitted - raw) ** 2; areaSum = next;
    });
    const coreFidelity = { samples: ownField?.valid.length ?? 0, sourceArea: areaSum, rms: areaSum ? Math.sqrt(weightedError / areaSum) : null, centeredRmsRetention: rawVariance > 0 ? Math.sqrt(Math.max(0, fitVariance) / rawVariance) : null, covarianceScale: rawVariance > 0 ? covariance / rawVariance : null };
    const allErrors = [...errors.core, ...errors.continued], own = original.get(part)!;
    report.regions.push({ part, beforeVertices: own.weights.length, vertices: row.mesh.weights.length, beforeTriangles: own.triangles.length / 3, triangles: row.mesh.triangles.length / 3, budget: manifest.bindings[part].triangles, exhausted: q.refined.exhausted, continued: q.continued, maxContinuation: q.maxContinuation, denseSamples: q.samples.length, depthRms: q.samples.length ? Math.sqrt(effectiveSquare / q.samples.length) : null, depthMax: q.samples.length ? effectiveMax : null, rawDepthRms: summary(allErrors).rms, rawDepthMax: summary(allErrors).max, rawSourceCore: summary(errors.core), rawContinuedBoundary: summary(errors.continued), rawNeutralVisible: summary(errors.visible), rawNeutralProtected: summary(errors.protected), rawCarried: summary(errors.carried), neutralVisibility: q.visibilityKnown ? 'all later bound neutral drawables, straight-RGBA bilinear alpha; packed-page conformance pending' : 'unavailable: later unbound drawable alpha is not owned', neutralProtection: owners.has(part) ? 'explicit later owner; original neutral material geometry and bilinear alpha' : 'unavailable: no declared later covering owner; HOST support is not occlusion', rejectedSplits: q.refined.rejectedSplits, emittedZ: [...row.z], coreFidelity, reliefRetention: coreFidelity.centeredRmsRetention });
  }
  for (const yaw of [-bands.yaw, 0, bands.yaw]) for (const pitch of [-bands.pitch, 0, bands.pitch]) {
    report.modelSpacePoses++;
    for (const [part, row] of surfaces) {
      const posed = row.mesh.weights.map((weights, i) => {
        const p: DepthUV = [0, 0];
        for (const w of weights) {
          const f = frames.get(w.bone)!, dy = row.z[i] * Math.sin(yaw * model.yawSign * Math.PI / 180), dp = row.z[i] * Math.sin(pitch * model.pitchSign * Math.PI / 180);
          const a = toBoneLocalVector(f, pivot.a * dy, pivot.c * dy), b = toBoneLocalVector(f, pivot.b * dp, pivot.d * dp), x = Math.fround(w.x) + Math.fround(pyRound(a[0], 4)) + Math.fround(pyRound(b[0], 4)), y = Math.fround(w.y) + Math.fround(pyRound(a[1], 4)) + Math.fround(pyRound(b[1], 4)), q = toBoneLocal(pivot, ...toWorld(f, x, y)), weight = Math.fround(w.weight); p[0] += weight * q[0]; p[1] += weight * q[1];
        }
        return p;
      });
      for (let t = 0; t < row.mesh.triangles.length; t += 3) { const ids = row.mesh.triangles.slice(t, t + 3), before = triangleArea(row.points, ids), after = triangleArea(posed, ids); if (!(before * after > 0)) return depthRefuse('RIG_DEPTH_TRIANGLE_FLIP', part, `exported triangle ${t / 3} area ${before} -> ${after} at yaw ${yaw}, pitch ${pitch}; no fallback`); }
    }
  }
  // Only now install the meshes/keys. All validation is complete before output.
  for (const [part, row] of surfaces) {
    const old = rig.skins.default[part][part]; rig.skins.default[part][part] = row.mesh;
    if (typeof rig.invariants?.meshSlots === 'number' && !('type' in old)) rig.invariants.meshSlots++;
    if (typeof rig.invariants?.meshTriangles === 'number') rig.invariants.meshTriangles += row.mesh.triangles.length / 3 - ('type' in old ? old.triangles.length / 3 : 0);
  }
  for (const [name, axis] of [['turn', 'yaw'], ['tilt', 'pitch']] as const) {
    const control = controls.get(axis); if (!control) return depthRefuse('RIG_DEPTH_BINDING', name, 'validated control schedule absent'); const { anim, keys, remove } = control;
    if (anim.deform?.some(d => manifest.bindings[d.slot])) return depthRefuse('RIG_DEPTH_BINDING', name, 'an authored deform conflicts with the managed source-only field');
    anim.tracks = anim.tracks.filter(t => !remove.has(t)); anim.deform ??= [];
    for (const [part, row] of surfaces) {
      const generated = { slot: part, attachment: part, keys: keys.map(k => {
      if (k.deg === 0 || row.z.every(z => z === 0)) return { t: k.t };
      const output: number[] = [];
      for (let i = 0; i < row.points.length; i++) { const p = row.points[i], q = projectDepth(...p, row.z[i], axis === 'yaw' ? k.deg * model.yawSign : 0, axis === 'pitch' ? k.deg * model.pitchSign : 0), dx = pivot.a * (q[0] - p[0]) + pivot.b * (q[1] - p[1]), dy = pivot.c * (q[0] - p[0]) + pivot.d * (q[1] - p[1]); for (const w of row.mesh.weights[i]) { const f = frames.get(w.bone); if (!f) return depthRefuse('RIG_DEPTH_BINDING', w.bone, 'weight frame absent'); const v = toBoneLocalVector(f, dx, dy); output.push(pyRound(v[0], 4), pyRound(v[1], 4)); } }
      return { t: k.t, vertices: output };
      }) };
      // Inspect the emitted (rounded) components at EVERY key. Neutral keys
      // within a moving timeline stay intact; exact identity has no timeline.
      if (generated.keys.some(k => k.vertices?.some(v => v !== 0))) anim.deform.push(generated);
    }
  }
  return report;
}
