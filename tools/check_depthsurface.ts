/** Independent public inputs and analytic controls for the opt-in field law. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encode } from 'jpeg-js';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { decodeDepth, depthChannel } from '../src/raster/depth.ts';
import { DEPTH_EYE_CHECK_LABEL, depthOwnership, parseDepthManifest, readDepthInput, sampleDepth, validateDepthTargets, type DepthManifest } from '../src/depthinput.ts';
import { coverageConstraints, type CoverageSurface } from '../src/depthcoverage.ts';
import { rigOutputTexts } from '../src/build.ts';
import type { RigOutput } from '../src/rig.ts';
import { refineDepthMesh, depthRowNorm, DepthLeastSquares } from '../src/depthmesh.ts';
import { applyDepthSurface, depthZ, projectDepth } from '../src/depthsurface.ts';
import { applyFaceSurfaceDeform, type SurfaceRig, type SliderAnimation } from '../src/turn.ts';
import { PartsError } from '../src/errors.ts';
import { loadPosable, sampleAnimation, sampleSetupPose } from 'rig-c/src/render.ts';
import { parseRigSpec } from 'rig-c/src/rig.ts';
import { parseMotionSpec } from 'rig-c/src/motion.ts';
import { DEFAULT_PACK_MODE, packedBuildArgs, type RigcRunner } from '../src/check.ts';
export type DepthSay = (name: string, pass: boolean, detail: string) => void;
const hash = (v: Uint8Array | Uint8ClampedArray | string): string => createHash('sha256').update(typeof v === 'string' ? v : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).digest('hex');
const near = (a: number, b: number, e = 1e-8): boolean => Math.abs(a - b) < e;
export const depthRefusal = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; } };
export function writeDepthFixture(dir: string, transparentCorner = false, size = 8, reliefPeak = false): DepthManifest {
  mkdirSync(dir, { recursive: true });
  const rgba = new Uint8ClampedArray(2 * size * size * 4), relief = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size * 2; x++) { const i = (y * size * 2 + x) * 4, v = x < size ? reliefPeak && x === 5 && y === 4 ? 224 : 192 : 64; rgba.set([32, 64, 96, 255], i); relief.set([v, v, v, 255], i); }
  const art = new Uint8ClampedArray(size * size * 4); for (let i = 0; i < size * size; i++) art.set([32, 64, 96, 255], i * 4);
  if (transparentCorner) { art[3] = 0; rgba[3] = 0; rgba[size * 4 + 3] = 0; }
  const page = encodePngBytes({ width: size * 2, height: size, data: rgba }), map = encodePngBytes({ width: size * 2, height: size, data: relief }), atlas = `page.png\nsize: ${size * 2},${size}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\npanel\n  bounds: 0,0,${size},${size}\nanchor\n  bounds: ${size},0,${size},${size}\n`, skeleton = JSON.stringify({ skins: [{ name: 'default', attachments: { panel: { panel: {} }, anchor: { anchor: {} } } }] });
  writeFileSync(join(dir, 'page.png'), page); writeFileSync(join(dir, 'art.png'), encodePngBytes({ width: size, height: size, data: art })); writeFileSync(join(dir, 'relief.png'), map); writeFileSync(join(dir, 'source.atlas'), atlas); writeFileSync(join(dir, 'source.json'), skeleton);
  const manifest: DepthManifest = {
    spec: 'rig-parts-depth/2', source: { file: 'relief.png', sha256: hash(map), width: size * 2, height: size, format: 'png', channel: 'red', polarity: 'white-near', processed: true },
    atlas: { file: 'source.atlas', sha256: hash(atlas), page: { file: 'page.png', sha256: hash(page), width: size * 2, height: size }, skeleton: { file: 'source.json', sha256: hash(skeleton) } },
    sampling: { resampler: 'triangle-bilinear-v1', alphaMin: 128, erode: 0, continuation: { kind: 'nearest-core', maxDistance: 2 } },
    model: { projection: 'depth-displacement', pivotBone: 'root', reliefGain: 2, gamma: 1, yawSign: 1, pitchSign: 1, legacy: 'replace-managed' },
    reference: { field: 'anchor', kind: 'core-median' }, coverage: { alphaMin: 128, overlaps: [] }, groups: { plate: ['root'] },
    bindings: { panel: { region: 'panel', bounds: [0, 0, size, size], mask: 'uv-alpha', triangles: 128, targetRgbaSha256: hash(art) }, anchor: { region: 'anchor', bounds: [size, 0, size, size], mask: 'uv-alpha', triangles: 128, targetRgbaSha256: hash(art) } },
  };
  writeFileSync(join(dir, 'depth.json'), JSON.stringify(manifest)); return manifest;
}
export function depthRig(size = 8): SurfaceRig {
  return { bones: [{ name: 'root', x: 0, y: 0 }, { name: 'yaw_dial', parent: 'root', x: 0, y: 0 }, { name: 'pitch_dial', parent: 'root', x: 0, y: 0 }], slots: [{ name: 'panel', bone: 'root', attachment: 'panel' }, { name: 'anchor', bone: 'root', attachment: 'anchor' }], constraints: [{ name: 'yaw', type: 'slider', bone: 'yaw_dial', property: 'rotate', from: -15, to: 0, scale: 1 / 30, max: 15, local: true, additive: true, mix: 1, animation: 'turn' }, { name: 'pitch', type: 'slider', bone: 'pitch_dial', property: 'rotate', from: -12, to: 0, scale: 1 / 24, max: 12, local: true, additive: true, mix: 1, animation: 'tilt' }], skins: { default: { panel: { panel: { type: 'mesh', image: 'art.png', width: size, height: size, hull: 4, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], weights: [[-size / 2, size / 2], [size / 2, size / 2], [size / 2, -size / 2], [-size / 2, -size / 2]].map(([x, y]) => [{ bone: 'root', x, y, weight: 1 }]) } }, anchor: { anchor: { image: 'art.png', x: size * 2, y: 0 } } } } };
}
export const depthMotion = (): { animations: { turn: SliderAnimation; tilt: SliderAnimation } } => {
  const control = (kind: 'yaw' | 'pitch'): SliderAnimation => ({ duration: 1, tracks: [{ group: 'plate', property: 'translatex', keys: [{ t: 0, derive: { kind, degrees: kind === 'yaw' ? -15 : -12 } }, { t: 0.5, v: [0] }, { t: 1, derive: { kind, degrees: kind === 'yaw' ? 15 : 12 } }] }] });
  return { animations: { turn: control('yaw'), tilt: control('pitch') } };
};
export function runDepthSurfaceChecks(dir: string, say: DepthSay): void {
  const m = writeDepthFixture(dir), input = readDepthInput(join(dir, 'depth.json')), field = input.fields.get('panel'); if (!field) throw Error('public fixture field absent');
  say('READER_REFERENCE', field.valid.length === 64 && near(field.reference, 64 / 255) && near(input.fields.get('anchor')?.reference ?? 0, field.reference), 'one explicit primary-core median supplies both fields; no layer parameters');
  // Hand-authored 12x12 UV-owned square, radius2 erosion: 8*8 centres.
  // The removed corner excludes exactly centre(2,2); this tests count, not rank.
  for (const dropCorner of [false, true]) {
    const folder = join(dir, dropCorner ? 'core63' : 'core64'), boundary = writeDepthFixture(folder, false, 12); boundary.sampling.erode = 2;
    if (dropCorner) {
      const page = decodePngBytes(readFileSync(join(folder, 'page.png')), 'public boundary page'); page.data[3] = 0; const bytes = encodePngBytes(page);
      writeFileSync(join(folder, 'page.png'), bytes); boundary.atlas.page.sha256 = hash(bytes);
      const art = decodePngBytes(readFileSync(join(folder, 'art.png')), 'public boundary art'); art.data[3] = 0; writeFileSync(join(folder, 'art.png'), encodePngBytes(art)); boundary.bindings.panel.targetRgbaSha256 = hash(art.data);
    }
    writeFileSync(join(folder, 'depth.json'), JSON.stringify(boundary));
    if (!dropCorner) {
      const accepted = readDepthInput(join(folder, 'depth.json'));
      say('CORE64_ELIGIBLE', accepted.fields.get('panel')?.valid.length === 64 && accepted.fields.get('anchor')?.valid.length === 64, '12x12 opaque source, radius2 erosion gives exactly64; eligibility only, no spatial-rank/quality claim');
    } else {
      const red = depthRefusal(() => readDepthInput(join(folder, 'depth.json')));
      say('CORE63_PLANT', red.includes('RIG_DEPTH_SAMPLE_UNSUPPORTED') && red.includes('has 63 texels') && red.includes('at least 64'), 'one missing source corner excludes exactly one eroded centre; named direct-field refusal');
      boundary.bindings.panel.host = 'anchor'; writeFileSync(join(folder, 'shared.json'), JSON.stringify(boundary));
      const shared = readDepthInput(join(folder, 'shared.json'));
      say('INELIGIBLE_EXPLICIT_HOST', shared.fields.size === 1 && shared.fields.has('anchor') && shared.manifest.bindings.panel.host === 'anchor', 'explicit host passes reader; whole-material geometry remains a separate mandatory producer check, never an inferred switch');
    }
  }
  say('DISPLACEMENT_ONLY', projectDepth(3, 4, 2, 90, 90).join(',') === '5,6' && projectDepth(3, 4, 0, 90, 90).join(',') === '3,4' && projectDepth(3, 4, 2, 0, 0).join(',') === '3,4', 'hand analytic sine displacement; zero Z and zero angles exact; cosine plant would move (3,4)');
  say('PORTABLE_ROW_NORM', depthRowNorm([3, 4]) === 5 && depthRowNorm([-3, 0, 4]) === 5 && depthRowNorm([]) === 0, 'hand Euclidean 3-4-5, sign and empty controls; deterministic multiply/add/sqrt');
  say('ROW_NORM_RANGE', Math.abs(depthRowNorm([3e300, 4e300]) / 5e300 - 1) <= 4 * Number.EPSILON && Math.abs(depthRowNorm([3e-300, 4e-300]) / 5e-300 - 1) <= 4 * Number.EPSILON && depthRowNorm([Number.MIN_VALUE]) === Number.MIN_VALUE, 'scaled hand 3-4-5 controls avoid square overflow/underflow, including a subnormal component');
  const invalidNorm = (values: number[]): string => { const q = new DepthLeastSquares(1); q.add({ ids: [0], values: [1] }, 1, 1); return depthRefusal(() => q.solve([{ ids: values.map(() => 0), values, upper: 1, object: 'public row' }])); };
  say('ROW_NORM_REFUSALS', [[0], [Infinity], [NaN], [Number.MAX_VALUE, Number.MAX_VALUE]].every(v => invalidNorm(v).includes('RIG_DEPTH_FIELD_SOLVE')), 'zero, nonfinite and mathematically out-of-range row norms refuse by name, never normalize to silent zeros');
  say('SOURCE_Z', near(depthZ(192 / 255, m.model, 'white-near', 64 / 255), 256 / 255), 'gain2 times source difference128/255; no scalar layer carry');
  say('POLARITY_PLANT', depthZ(192 / 255, m.model, 'white-near', 64 / 255) > 0 && !(depthZ(192 / 255, m.model, 'black-near', 64 / 255) > 0), 'inversion reverses the hand-known near-point response');
  const mask = depthOwnership(4, 4, [0, 0, 1, 0, 0, 1], [0, 1, 2], new Uint8Array(16).fill(255), 128, 0);
  say('OWNERSHIP', mask.reduce((a, b) => a + b, 0) === 10 && mask[15] === 0, 'ten triangle-owned centres; rectangular corner excluded');
  const bad = structuredClone(m) as unknown as Record<string, unknown>; bad.spec = 'rig-parts-depth/1'; (bad.model as Record<string, unknown>).layerGain = 1; delete (bad.bindings as Record<string, Record<string, unknown>>).panel.mask; (bad.source as Record<string, unknown>).width = -1;
  const diagnostics = depthRefusal(() => parseDepthManifest(bad));
  say('COLLECT_ALL', ['depth.spec', 'depth.model.layerGain', 'depth.bindings.panel.mask', 'depth.source.width'].every(k => diagnostics.includes(k)), 'old law, independent negative dimension and missing mask are all diagnosed together');
  const shifted = structuredClone(m); shifted.bindings.panel.bounds[0] = 1; writeFileSync(join(dir, 'shifted.json'), JSON.stringify(shifted));
  say('SHIFT_PLANT', depthRefusal(() => readDepthInput(join(dir, 'shifted.json'))).includes('RIG_DEPTH_BINDING'), 'actual reader refuses an off-part source registration');
  const broken = structuredClone(m); writeFileSync(join(dir, 'broken-source.json'), '{'); broken.atlas.skeleton = { file: 'broken-source.json', sha256: hash('{') }; writeFileSync(join(dir, 'broken.json'), JSON.stringify(broken));
  say('BROKEN_JSON', depthRefusal(() => readDepthInput(join(dir, 'broken.json'))).includes('RIG_DEPTH_BINDING'), 'hash-valid malformed source JSON is a named reader refusal');
  const schemaPlants = [{}, { skins: [] }, { skins: [{ attachments: { panel: { panel: { type: 'mesh', uvs: [0, 0, Infinity, 1], triangles: [0, 1, 99], hull: 9 } } } }] }];
  const schemaRed = schemaPlants.every((raw, i) => { const bytes = JSON.stringify(raw), named = structuredClone(m); writeFileSync(join(dir, `schema-${i}.json`), bytes); named.atlas.skeleton = { file: `schema-${i}.json`, sha256: hash(bytes) }; writeFileSync(join(dir, `manifest-${i}.json`), JSON.stringify(named)); return depthRefusal(() => readDepthInput(join(dir, `manifest-${i}.json`))).includes('RIG_DEPTH_BINDING'); });
  say('SOURCE_SCHEMA_PLANTS', schemaRed, 'hash-valid missing/wrong skins and invalid finite UV/triangle/hull data refuse by name');
  const digest = structuredClone(m); digest.source.sha256 = '0'.repeat(64); writeFileSync(join(dir, 'digest.json'), JSON.stringify(digest));
  say('HASH_PLANT', depthRefusal(() => readDepthInput(join(dir, 'digest.json'))).includes('RIG_DEPTH_BINDING'), 'actual source bytes cannot reuse a different declaration');
  const cap = structuredClone(m); cap.bindings.panel.triangles = 2049;
  say('CAP_REFUSAL', depthRefusal(() => parseDepthManifest(cap)).includes('2048'), 'the declared per-binding cap cannot exceed the frozen supported maximum');
  say('TARGET_BYTES', depthRefusal(() => validateDepthTargets(input, [['panel.png', { width: 8, height: 8, data: new Uint8ClampedArray(256) }]])).includes('RIG_DEPTH_BINDING'), 'wrong straight RGBA cannot inherit registration');
  say('CONTINUATION', near(sampleDepth(field, 0, 0, m.sampling.continuation).continued, Math.SQRT1_2) && depthRefusal(() => sampleDepth(field, 0, 0, { kind: 'refuse', maxDistance: 0 })).includes('RIG_DEPTH_SAMPLE_UNSUPPORTED') && depthRefusal(() => sampleDepth(field, -1, 0, m.sampling.continuation)).includes('RIG_DEPTH_SAMPLE_UNSUPPORTED'), 'declared bounded nearest query, refuse and excessive distance');
  const rig = depthRig(), motion = depthMotion(); applyFaceSurfaceDeform(rig, motion, { depth: input });
  say('REAL_ENTRY', motion.animations.turn.tracks.length === 0 && motion.animations.turn.deform?.length === 1 && motion.animations.turn.deform[0].slot === 'panel' && motion.animations.tilt.deform?.length === 1 && motion.animations.tilt.deform[0].slot === 'panel' && input.report.modelSpacePoses === 9 && input.report.regions.every(r => !r.exhausted && r.depthMax !== null && r.depthMax < 1e-8), 'nonliteral face entry emits only per-vertex field deforms, actual nine model-space checks');
  const moving = motion.animations.turn.deform?.find(d => d.slot === 'panel');
  say('EXACT_IDENTITY_OMITTED', !motion.animations.turn.deform?.some(d => d.slot === 'anchor') && !motion.animations.tilt.deform?.some(d => d.slot === 'anchor') && moving?.keys.length === 3 && moving.keys[1].vertices === undefined, 'flat primary emits no identity timelines; nonzero surface retains both axes and its neutral key');
  const start = moving?.keys[0].vertices, end = moving?.keys[2].vertices;
  say('CANCELLATION_RETAINED', !!start && !!end && start.some(v => v !== 0) && start.every((v, i) => v + end[i] === 0), 'endpoint offsets sum to zero and neutral pose is zero, but the moving timeline remains');
  const rounded = readDepthInput(join(dir, 'depth.json')); rounded.manifest.model.reliefGain = 0.00001; const roundedMotion = depthMotion(); applyDepthSurface(depthRig(), roundedMotion, rounded, { yaw: 15, pitch: 12 });
  say('EMITTED_ZERO_ONLY', depthZ(192 / 255, rounded.manifest.model, 'white-near', 64 / 255) !== 0 && roundedMotion.animations.turn.deform?.length === 0 && roundedMotion.animations.tilt.deform?.length === 0, 'nonzero raw field whose emitted rounded components are all exact zero has no generated timeline; no raw-Z threshold');
  const single = readDepthInput(join(dir, 'depth.json')), singleField = single.fields.get('panel'); if (!singleField) throw Error('public single-component field absent'); for (let i = 0; i < singleField.values.length; i++) singleField.values[i] = (64 + 128 * (1 - Math.max((i % 8 + 0.5) / 8, (Math.floor(i / 8) + 0.5) / 8))) / 255; single.manifest.bindings.panel.triangles = 2;
  const singleRig = depthRig(), singleMotion = depthMotion(), scale = 1 / (1 + 0.000001); singleRig.constraints![0].from = -0.000001; singleRig.constraints![0].scale = scale;
  singleMotion.animations.turn.tracks[0].keys = [{ t: 0, derive: { kind: 'yaw', degrees: -0.000001 } }, { t: 0.000001 * scale, v: [0] }, { t: 1, derive: { kind: 'yaw', degrees: 1 } }];
  const singleReport = applyDepthSurface(singleRig, singleMotion, single, { yaw: 15, pitch: 12 }); const kept = singleMotion.animations.turn.deform?.find(d => d.slot === 'panel');
  say('ONE_COMPONENT_ONE_KEY', kept?.keys.length === 3 && kept.keys[1].vertices === undefined && kept.keys.flatMap(k => k.vertices ?? []).filter(v => v !== 0).length === 1 && singleMotion.animations.tilt.deform?.some(d => d.slot === 'panel') === true, 'one emitted nonzero component at one key prevents omission; both axes, all three keys and neutral retained');
  const fidelity = singleReport.regions.find(r => r.part === 'panel')!.coreFidelity;
  say('RAW_CORE_RELIEF_RETENTION', fidelity.samples === 64 && near(fidelity.sourceArea, 64) && (fidelity.rms ?? 1) < 1e-8 && near(fidelity.centeredRmsRetention ?? -1, 1) && near(fidelity.covarianceScale ?? -1, 1) && input.report.regions.every(r => r.coreFidelity.centeredRmsRetention === null && r.coreFidelity.covarianceScale === null), 'exact affine hat retains centered RMS1/regression1 on the objective core area64; constant RAW variance is null, not fabricated retention');
  const erodedDir = join(dir, 'eroded'), eroded = writeDepthFixture(erodedDir, false, 10); eroded.sampling.erode = 1; eroded.sampling.continuation.maxDistance = 3; writeFileSync(join(erodedDir, 'depth.json'), JSON.stringify(eroded));
  const erodedInput = readDepthInput(join(erodedDir, 'depth.json')), erodedReport = applyDepthSurface(depthRig(10), depthMotion(), erodedInput, { yaw: 15, pitch: 12 }), erodedRow = erodedReport.regions.find(r => r.part === 'panel');
  say('CORE_CONTINUED_SPLIT', erodedRow?.rawSourceCore.samples === 64 && erodedRow.rawContinuedBoundary.samples === 36 && erodedRow.denseSamples === 100 && (erodedRow.rawSourceCore.max ?? 1) < 1e-8 && (erodedRow.rawContinuedBoundary.max ?? 1) < 1e-8, '8x8 valid core and 36 continued opaque boundary centres reported separately; all-alpha is not mislabeled core');
  const zero = readDepthInput(join(dir, 'depth.json')); zero.manifest.model.reliefGain = 0; const zr = depthRig(), before = JSON.stringify(zr); applyDepthSurface(zr, depthMotion(), zero, { yaw: 15, pitch: 12 });
  say('ZERO_GAIN_BYTES', JSON.stringify(zr) === before && zero.report.regions.length === 0, 'zero gain bypasses promotion and remeshing; setup object bytes unchanged');
  const missing = depthMotion(); missing.animations.turn.tracks = []; say('MISSING_DERIVE', depthRefusal(() => applyFaceSurfaceDeform(depthRig(), missing, { depth: input })).includes('RIG_DEPTH_BINDING'), 'opt-in cannot silently skip an absent explicit axis schedule');
  const wrongSchedule = depthMotion(); wrongSchedule.animations.turn.tracks.push(structuredClone(wrongSchedule.animations.turn.tracks[0])); wrongSchedule.animations.turn.tracks[1].keys[0].derive!.degrees = -14;
  say('SCHEDULE_PLANT', depthRefusal(() => applyDepthSurface(depthRig(), wrongSchedule, input, { yaw: 15, pitch: 12 })).includes('disagree'), 'conflicting owned schedules do not pick the first track');
  const nonadd = depthRig(); delete nonadd.constraints?.[0].additive; say('SLIDER_PLANT', depthRefusal(() => applyDepthSurface(nonadd, depthMotion(), input, { yaw: 15, pitch: 12 })).includes('additive:true'), 'missing additive composition is refused before emission');
  const foreign = depthRig(); foreign.bones.push({ name: 'foreign', x: 0, y: 0 }); const unmanaged = depthMotion(); unmanaged.animations.turn.tracks.push({ bone: 'foreign', property: 'translatey', keys: [{ t: 0, v: [7] }] }); applyDepthSurface(foreign, unmanaged, input, { yaw: 15, pitch: 12 });
  say('UNMANAGED_PRESERVED', unmanaged.animations.turn.tracks.some(t => t.bone === 'foreign' && Array.isArray(t.keys[0].v) && t.keys[0].v[0] === 7), 'unrelated non-derived behavior remains owned by its original track');
  const mixed = depthMotion(); mixed.animations.turn.tracks.push({ bone: 'foreign', property: 'translatey', keys: [{ t: 0, derive: { kind: 'yaw', degrees: -15 } }] });
  say('MIXED_REFUSAL', depthRefusal(() => applyDepthSurface(depthRig(), mixed, input, { yaw: 15, pitch: 12 })).includes('resolve explicitly'), 'unresolved/mixed derive ownership is named, never discarded');
  const spin = depthMotion(); spin.animations.turn.tracks.push({ bone: 'root', property: 'rotate', keys: [{ t: 0, v: [5] }] });
  say('SPIN_PLANT', depthRefusal(() => applyDepthSurface(depthRig(), spin, input, { yaw: 15, pitch: 12 })).includes('managed surface'), 'another managed yaw/pitch rotation cannot compose with source-only displacement');
  const singular = depthRig(); singular.bones[0].scaleX = 0;
  say('SINGULAR_FRAME', depthRefusal(() => applyDepthSurface(singular, depthMotion(), input, { yaw: 15, pitch: 12 })).includes('invertible'), 'singular setup frame refuses rather than emitting invalid inverse weights');
  const inherit = depthRig(); inherit.bones[0].inherit = 'noScale';
  say('INHERIT_REFUSAL', depthRefusal(() => applyDepthSurface(inherit, depthMotion(), input, { yaw: 15, pitch: 12 })).includes('normal inheritance'), 'non-normal setup ancestry has an explicit supported-frame refusal');
  const rgba = new Uint8Array(64).fill(255); for (let i = 0; i < 16; i++) rgba.set([96, 96, 96, 255], i * 4); const jpeg = decodeDepth(encode({ width: 4, height: 4, data: rgba }, 100).data, 'jpeg-rgb8', 'public JPEG');
  const repaired = join(dir, 'coupled-curve-reader'); runCompiledDepthChecks(repaired, (name, pass, detail) => { if (!pass) throw Error(name + detail); }, () => { throw Error('No compiler during reader control'); }, true, 10, true);
  say('COUPLED_CURVATURE_PRODUCER', true, 'real derived entry: source-core constrained approximation, eligibility and all rounded combined-pose checks completed; no gain or source change');
  say('JPEG', jpeg.width === 4 && Math.abs(jpeg.data[0] - 96) <= 1, 'installed pinned encoder/decoder, known constant patch');
  say('FILTER', near(depthChannel({ width: 2, height: 1, data: Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255]) }, 1, 1)[0], 0.5), 'whole-image half-pixel triangle downsampling of a symmetric pair');
}

/** Mandatory real compile/gate then actual posed vertices, never model-only folds. */
export function runCompiledDepthChecks(dir: string, say: DepthSay, runner: RigcRunner, readersOnly = false, size = 10, curved = false, single = false, interiorHost = false): void {
  if (!single && !curved) { runCompiledDepthChecks(join(dir, 'flat'), say, runner, readersOnly, 10, false, true); runCompiledDepthChecks(join(dir, 'coupled'), say, runner, readersOnly, 16, true, true); return; }
  let worst = 0, folds = 0, compiled = 0, zeroExact = true;
  for (const rotation of [270, -270]) {
    const folder = join(dir, String(rotation)); const manifest = writeDepthFixture(folder, true, size, curved); manifest.bindings.panel.triangles = 2 + 2 * (size * size - 1); writeFileSync(join(folder, 'depth.json'), JSON.stringify(manifest)); const input = readDepthInput(join(folder, 'depth.json')), rig = depthRig(size);
    // Independently authored geometry fixture: exercise the actual adaptive
    // shared-edge insertion, then constant source depth isolates transport and
    // native weight/topology preservation from unsupported field folds below.
    if (!curved) {
      const seed = rig.skins.default.panel.panel; if (!('type' in seed)) throw Error('public mesh absent');
      const centre = (uv: [number, number]): number => uv[0] === 0.5 && uv[1] === 0.5 ? 1 : 0;
      rig.skins.default.panel.panel = refineDepthMesh(seed, [{ uv: [0.5, 0.5], z: 1 }], centre, 4).mesh;
    }
    rig.bones[0] = { name: 'root', x: 3, y: 5, rotation: 30, scaleX: 1.2, scaleY: 0.8, shearY: 7 };
    rig.bones.push({ name: 'feature', parent: 'root', x: 0, y: 0, rotation, scaleX: rotation < 0 ? -1 : 1 }); rig.slots?.push({ name: 'overlay', bone: 'feature', attachment: 'overlay' }); rig.skins.default.overlay = { overlay: { image: 'art.png', x: 0, y: 0, ...(interiorHost ? { x: 0.5, y: 1.25, scaleX: 0.4, scaleY: 0.2 } : {}) } }; input.manifest.bindings.overlay = { ...input.manifest.bindings.panel, host: 'panel' }; input.images.set('overlay', input.images.get('panel')!);
    const corners: Array<[number, number]> = [-15, 0, 15].flatMap(yaw => [-12, 0, 12].map(pitch => [yaw, pitch] as [number, number])); corners.push([-0.1, 0], [0.1, 0]);
    const motion = { spec: 'rigc-motion/1', archetype: 'depth-control', cut: 'depth-control', easings: {}, groups: input.manifest.groups, animations: { ...depthMotion().animations, probe: { duration: corners.length - 1, tracks: ['yaw_dial', 'pitch_dial'].map((bone, axis) => ({ bone, property: 'rotate', keys: corners.map((pair, t) => ({ t, v: [pair[axis]] })) })) } } };
    applyFaceSurfaceDeform(rig, motion, { depth: input }); if (!curved && !input.report.regions.some(r => r.part === 'panel' && r.vertices === 5)) throw Error('Independent adaptive shared-edge geometry absent'); const spec = { spec: 'rigc-rig/1', name: 'depth-control', images: '.', skeleton: { x: -64, y: -64, width: 128, height: 128 }, ...rig };
    parseRigSpec(spec, 'public depth rig'); parseMotionSpec(motion, 'public depth motion'); writeFileSync(join(folder, 'rig.json'), JSON.stringify(spec)); writeFileSync(join(folder, 'motion.json'), JSON.stringify(motion)); writeFileSync(join(folder, 'final-field.json'), JSON.stringify(input.report));
    if (readersOnly) continue;
    for (const profile of ['rig-play', 'spine'] as const) {
    const flags = profile === 'rig-play' ? packedBuildArgs(DEFAULT_PACK_MODE) : ['--profile', 'spine'];
    const out = join(folder, `build-${profile}`), result = runner(['build', '--rig', join(folder, 'rig.json'), '--motion', join(folder, 'motion.json'), '--out', out, ...flags]); writeFileSync(join(folder, `compile-${profile}.log`), result.out);
    if (result.status !== 0) { say('COMPILED_FIELD', false, result.out); return; } compiled++;
    const { data } = loadPosable(join(out, 'skeleton.json'), join(out, 'skeleton.atlas'), out), frames = sampleAnimation(data, 'probe', 1, { bones: true }), neutral = sampleSetupPose(data, { bones: true })[0], root = neutral.bones?.find(b => b.name === 'root'); if (!root) throw Error('compiled root absent');
    for (const [i, frame] of frames.entries()) {
      const sx = Math.sin(corners[i][0] * Math.PI / 180), sy = Math.sin(corners[i][1] * Math.PI / 180);
      for (const part of ['panel', 'overlay']) {
        const mesh = frame.pieces.find(p => p.slot === part), base = neutral.pieces.find(p => p.slot === part); if (!mesh || mesh.kind !== 'mesh' || !base || base.kind !== 'mesh') throw Error('promoted compiled mesh absent');
        // New vertices are authored texel centres; seed vertices are corners.
        // A single public pixel(5,4) is224, every other panel pixel192, anchor64.
        for (let k = 0; k < mesh.world.length; k += 2) {
          const x = base.world[k] - root.worldX, y = base.world[k + 1] - root.worldY, det = root.a * root.d - root.b * root.c;
          const localX = (root.d * x - root.b * y) / det, localY = (-root.c * x + root.a * y) / det;
          const z = curved ? input.report.regions.find(r => r.part === part)!.emittedZ[k / 2] : 256 / 255, dx = z * sx, dy = z * sy;
          worst = Math.max(worst, Math.abs(mesh.world[k] - base.world[k] - root.a * dx - root.b * dy), Math.abs(mesh.world[k + 1] - base.world[k + 1] - root.c * dx - root.d * dy));
        }
        if (corners[i][0] === 0 && corners[i][1] === 0) zeroExact &&= JSON.stringify(mesh.world) === JSON.stringify(base.world);
        const area = (v: ArrayLike<number>, ids: number[]): number => { const [a, b, c] = ids; return (v[b * 2] - v[a * 2]) * (v[c * 2 + 1] - v[a * 2 + 1]) - (v[b * 2 + 1] - v[a * 2 + 1]) * (v[c * 2] - v[a * 2]); };
        for (let t = 0; t < mesh.triangles.length; t += 3) { const ids = Array.from(mesh.triangles).slice(t, t + 3); if (area(mesh.world, ids) * area(base.world, ids) <= 0) folds++; }
      }
      const feature = frame.bones?.find(b => b.name === 'feature'), setup = neutral.bones?.find(b => b.name === 'feature'); if (JSON.stringify(feature) !== JSON.stringify(setup)) throw Error('hidden tangent/spin changed feature bone');
    }
    writeFileSync(join(folder, `posed-${profile}.json`), JSON.stringify(frames));
    if (rotation === 270) {
      const planted = structuredClone(motion);
      for (const name of ['turn', 'tilt'] as const) planted.animations[name].deform?.push({ slot: 'anchor', attachment: 'anchor', keys: [{ t: 0 }, { t: 0.5 }, { t: 1 }] });
      const file = join(folder, 'motion-zero-plant.json'); writeFileSync(file, JSON.stringify(planted));
      const red = runner(['build', '--rig', join(folder, 'rig.json'), '--motion', file, '--out', join(folder, `identity-plant-${profile}`), ...flags]); writeFileSync(join(folder, `identity-plant-${profile}.log`), red.out);
      say(`IDENTITY_A40_PLANT_${profile}`, red.status !== 0 && /FAIL\s+A40_SLIDERS_COMPOSE_ON_A_SHARED_TARGET/.test(red.out), 'reintroducing only the redundant zero timelines makes the unchanged mandatory gate RED');
    }
    }
  }
  say(readersOnly ? 'COMPILED_READERS' : 'COMPILED_FIELD', readersOnly || (compiled === 4 && worst < 0.002 && folds === 0 && zeroExact), readersOnly ? 'both complete fixtures passed actual rig/motion readers; no compile claim' : `${compiled} mandatory compiles (package rig-play packed + explicit Spine, identical corrected inputs); ${interiorHost ? 'independent authored interior4x2 HOST; original boundary regression NOT cleared; ' : ''}nonunit/sheared translated frames, setup +/-270, ${curved ? 'coupled constrained source peak' : 'independent adaptive shared-edge constant field'}, 9 corners plus near-zero. Max displacement error ${worst}, folds ${folds}, neutral geometry bytes ${zeroExact}; feature bone remains unchanged.`);
}

/** Explicit temporary pilot controls; independent public source, no private art. */
export function runDepthPilotChecks(dir: string, say: DepthSay): void {
  const manifest = writeDepthFixture(dir); manifest.pilot = { mode: 'mixed-alpha-final-coverer', label: DEPTH_EYE_CHECK_LABEL };
  say('PILOT_EXPLICIT_PARSE', parseDepthManifest(manifest).pilot?.label === DEPTH_EYE_CHECK_LABEL, 'explicit annotation preserves the exact EYE-CHECK PILOT, not shippable label');
  const bad = structuredClone(manifest) as unknown as { pilot: Record<string, unknown> }; bad.pilot.mode = 'automatic'; bad.pilot.label = 'ship'; bad.pilot.extra = true;
  const message = depthRefusal(() => parseDepthManifest(bad));
  say('PILOT_LABEL_MODE_PLANT', ['depth.pilot.mode', 'depth.pilot.label', 'depth.pilot.extra'].every(k => message.includes(k)), 'independent invalid pilot fields are all diagnosed; no environment switch or unknown Core field');
  const plain = structuredClone(manifest); delete plain.pilot;
  say('PILOT_NO_DEFAULT', parseDepthManifest(plain).pilot === undefined, 'ordinary manifests never silently enter pilot mode');
  const mesh = depthRig(4).skins.default.panel.panel; if (!('type' in mesh)) throw Error('Independent public quad missing');
  const rgba = new Uint8ClampedArray(64).fill(255), island = new Uint8ClampedArray(64); island.set([255,255,255,255], (1 * 4 + 1) * 4);
  const subject: CoverageSurface = { mesh, points: [[0,4],[4,4],[4,0],[0,0]], z: [0,0,0,0], image: { width:4,height:4,data:rgba } };
  const coverer: CoverageSurface = { ...subject, z:[2,3,4,3], image:{ width:4,height:4,data:island } };
  say('PILOT_STRICT_MIXED_RED', depthRefusal(() => coverageConstraints(subject,coverer,128)).includes('RIG_DEPTH_COVERAGE_ALPHA_UNSUPPORTED'), 'the same padded alpha island is refused without explicit pilot annotation');
  const carry = coverageConstraints(subject,coverer,128,false,manifest.pilot), area = carry.fallbacks.reduce((s,c)=>s+c.sourceArea,0), centre = carry.value([0.375,0.375]), padding = carry.value([0.875,0.875]);
  say('PILOT_MIXED_SPATIAL_FINAL_CARRY', near(centre ?? -1,2.75) && near(padding ?? -1,3.75) && carry.fallbacks.length===2 && near(area,16) && new Set(carry.fallbacks.map(c=>c.cellID)).size===2, 'two hand quad cells: spatial final coverer Z=2+u+v, including visible padding; all16source area units and both cell IDs reported');
  coverer.z=coverer.z.map(z=>z+1);
  say('PILOT_FINAL_NOT_RAW_OR_ZERO', near(carry.value([0.375,0.375])??-1,3.75) && near(carry.value([0.875,0.875])??-1,4.75), 'changing final coverer field updates both queries; own relief and zero/constant substitution are not used');
  const input = readDepthInput(join(dir,'depth.json')), rig=depthRig(), motion=depthMotion(); input.manifest.pilot=manifest.pilot; applyFaceSurfaceDeform(rig,motion,{depth:input});
  say('PILOT_TIMELINE_NONZERO', motion.animations.turn.deform?.some(d=>d.slot==='panel')===true && motion.animations.tilt.deform?.some(d=>d.slot==='panel')===true && !motion.animations.turn.deform?.some(d=>d.slot==='anchor'), 'nonzero axis fields retain both timelines; exact-zero primary timelines are omitted');
  const zero=readDepthInput(join(dir,'depth.json'));zero.manifest.pilot=manifest.pilot;zero.manifest.model.reliefGain=0;const zr=depthRig(),before=JSON.stringify(zr),zm=depthMotion();applyFaceSurfaceDeform(zr,zm,{depth:zero});
  say('PILOT_ZERO_GEOMETRY', JSON.stringify(zr)===before && !zm.animations.turn.deform?.length && zero.report.pilot?.fallbackCount===0, 'explicit zero does not create mesh or fallback motion; label exists only in sidecar/report');
  const built={rig:{spec:'rigc-rig/1',name:DEPTH_EYE_CHECK_LABEL,images:'.',...rig},motion:{spec:'rigc-motion/1',archetype:DEPTH_EYE_CHECK_LABEL,cut:'public',easings:{},animations:motion.animations},meshReport:{},depthReport:input.report} as unknown as RigOutput;
  const texts=rigOutputTexts(built,null),metadata=JSON.parse(texts.find(([n])=>n==='PILOT.json')![1]);
  say('PILOT_ACTUAL_SERIALIZATION',metadata.label===DEPTH_EYE_CHECK_LABEL && metadata.requiredPageBanner===DEPTH_EYE_CHECK_LABEL && metadata.shippable===false && JSON.parse(texts.find(([n])=>n==='rig.json')![1]).name===DEPTH_EYE_CHECK_LABEL,'actual producer serializer writes adjacent PILOT.json, exact model name/report/banner label; no unknown Core schema field');
}

/** Hand plane: panel raw Z=128/255*(u+v), co-located owner raw Z=0.
 * Equal source areas and exact coupling give final Z=64/255*(u+v).
 * The shared follower uses the SAME actual scaled/sheared runtime frame.
 * The older quarter-turn HOST precision refusal remains a separate limitation.
 */
export function writePilotNativeFixture(folder: string): { spec: unknown; motion: unknown; report: import('../src/depthsurface.ts').DepthReport } {
  const size=16, manifest=writeDepthFixture(folder,true,size);
  const map=decodePngBytes(readFileSync(join(folder,'relief.png')),'public plane');
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size*2+x)*4,v=64+(64/size)*(x+y+1);map.data.set([v,v,v,255],i);}
  const bytes=encodePngBytes(map);writeFileSync(join(folder,'relief.png'),bytes);manifest.source.sha256=hash(bytes);
  manifest.pilot={mode:'mixed-alpha-final-coverer',label:DEPTH_EYE_CHECK_LABEL};manifest.coverage.overlaps=[{subject:'panel',coverer:'anchor'}];
  for(const b of Object.values(manifest.bindings))b.triangles=16;
  manifest.bindings.overlay={...manifest.bindings.panel,host:'panel'};writeFileSync(join(folder,'depth.json'),JSON.stringify(manifest));
  const input=readDepthInput(join(folder,'depth.json')),rig=depthRig(size);rig.bones[0]={name:'root',x:3,y:5,rotation:30,scaleX:1.2,scaleY:0.8,shearY:7};
  const anchor=rig.skins.default.anchor.anchor;if('type'in anchor)throw Error('public anchor region missing');anchor.x=0;
  // This hand positive defines identical co-located two-triangle source seeds.
  // The older opposite-diagonal region/mesh input and its budget RED are retained.
  rig.skins.default.anchor.anchor=structuredClone(rig.skins.default.panel.panel);
  rig.slots?.push({name:'overlay',bone:'root',attachment:'overlay'});
  const panel=rig.skins.default.panel.panel;if(!('type'in panel))throw Error('public panel mesh missing');const overlay=structuredClone(panel);rig.skins.default.overlay={overlay};
  const corners:Array<[number,number]>=[-15,0,15].flatMap(y=>[-12,0,12].map(p=>[y,p]as[number,number]));
  const motion={spec:'rigc-motion/1',archetype:DEPTH_EYE_CHECK_LABEL,cut:'pilot-public',easings:{},groups:manifest.groups,animations:{...depthMotion().animations,probe:{duration:8,tracks:['yaw_dial','pitch_dial'].map((bone,axis)=>({bone,property:'rotate',keys:corners.map((pair,t)=>({t,v:[pair[axis]]}))}))}}};
  try { applyFaceSurfaceDeform(rig,motion,{depth:input}); } catch(error) { writeFileSync(join(folder,'reader-stop.json'),JSON.stringify({report:input.report,rig,message:error instanceof Error?error.message:String(error)},null,2));throw error; } const spec={spec:'rigc-rig/1',name:DEPTH_EYE_CHECK_LABEL,images:'.',skeleton:{x:-64,y:-64,width:128,height:128},...rig};parseRigSpec(spec,'pilot analytic plane');parseMotionSpec(motion,'pilot analytic sliders');
  writeFileSync(join(folder,'rig.json'),JSON.stringify(spec));writeFileSync(join(folder,'motion.json'),JSON.stringify(motion));writeFileSync(join(folder,'PILOT.json'),JSON.stringify(input.report.pilot));writeFileSync(join(folder,'final-field.json'),JSON.stringify(input.report));return{spec,motion,report:input.report};
}
export function runPilotCompiledDepthChecks(folder:string,say:DepthSay,runner:RigcRunner,readersOnly=false):void{
  // Independent positive: an authored 4x2 material at (1/2,5/4) lies inside
  // the 10x10 host, away from its centre and coincident source boundaries.
  // It still uses the original +/-270 child, reflection, root shear and region
  // promotion. This does NOT replace or clear the original coincident-boundary
  // fixture, whose generated Float32 sliver remains a separate regression.
  if (!readersOnly) runCompiledDepthChecks(join(folder, 'interior-quarter-turn'), say, runner, false, 10, false, true, true);
  const fixture=writePilotNativeFixture(folder),follower=fixture.report.regions.find(r=>r.part==='overlay');
  say('PILOT_HOST_VISIBLE_REPORT',follower?.rawNeutralVisible.samples===255&&follower.rawNeutralProtected.samples===0&&follower.rawCarried.samples===255&&fixture.report.coverage.some(c=>c.subject==='overlay'&&c.kind==='host-support'&&c.protectedTexels===0),'hand16x16 follower with one transparent corner, drawn after its fully supporting host:255visible/carried,0physicalprotected; HOST support separately labelled');
  if(readersOnly){say('PILOT_NATIVE_READERS',true,'actual labelled rig/motion/PNG/depth readers; core compile still pending');return;}
  let worst=0,folds=0,neutralExact=true,compiled=0;const corners:Array<[number,number]>=[-15,0,15].flatMap(y=>[-12,0,12].map(p=>[y,p]as[number,number]));
  for(const profile of ['rig-play','spine']as const){const out=join(folder,'build-'+profile),result=runner(['build','--rig',join(folder,'rig.json'),'--motion',join(folder,'motion.json'),'--out',out,...(profile==='rig-play'?packedBuildArgs(DEFAULT_PACK_MODE):['--profile','spine'])]);writeFileSync(join(folder,'compile-'+profile+'.log'),result.out);if(result.status!==0){say('PILOT_NATIVE_GATE',false,result.out);return;}compiled++;
    const{data}=loadPosable(join(out,'skeleton.json'),join(out,'skeleton.atlas'),out),frames=sampleAnimation(data,'probe',1,{bones:true}),neutral=sampleSetupPose(data,{bones:true})[0],root=neutral.bones!.find(b=>b.name==='root')!;
    for(const[i,frame]of frames.entries())for(const part of ['panel','anchor','overlay']){const base=neutral.pieces.find(p=>p.slot===part),posed=frame.pieces.find(p=>p.slot===part);if(!base||base.kind!=='mesh'||!posed||posed.kind!=='mesh')throw Error('coupled public mesh absent');
      for(let k=0;k<base.world.length;k+=2){const x=base.world[k]-root.worldX,y=base.world[k+1]-root.worldY,det=root.a*root.d-root.b*root.c,lx=(root.d*x-root.b*y)/det,ly=(-root.c*x+root.a*y)/det,z=64/255*(1+lx/16-ly/16),dx=z*Math.sin(corners[i][0]*Math.PI/180),dy=z*Math.sin(corners[i][1]*Math.PI/180);worst=Math.max(worst,Math.abs(posed.world[k]-base.world[k]-root.a*dx-root.b*dy),Math.abs(posed.world[k+1]-base.world[k+1]-root.c*dx-root.d*dy));}
      if(corners[i][0]===0&&corners[i][1]===0)neutralExact&&=JSON.stringify(base.world)===JSON.stringify(posed.world);
      const area=(v:ArrayLike<number>,a:number,b:number,c:number):number=>(v[b*2]-v[a*2])*(v[c*2+1]-v[a*2+1])-(v[b*2+1]-v[a*2+1])*(v[c*2]-v[a*2]);for(let t=0;t<posed.triangles.length;t+=3){const[a,b,c]=Array.from(posed.triangles).slice(t,t+3);if(area(posed.world,a,b,c)*area(base.world,a,b,c)<=0)folds++;}
    }writeFileSync(join(folder,'posed-'+profile+'.json'),JSON.stringify(frames));
  }
  say('PILOT_NATIVE_COUPLED_PLANE',compiled===2&&worst<0.002&&folds===0&&neutralExact,`actual package rig-play packed and explicit Spine gates; independent equal-area plane solution64/255*(u+v), direct+HOST, nonunit/sheared root shared by the follower;9corners displacement error${worst},folds${folds},neutral geometry bytes${neutralExact}; old quarter-turn HOST precision boundary not claimed repaired`);
}
