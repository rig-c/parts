/** Flat blocks with independent scalar ramps; no character artwork. */
import { createHash } from 'node:crypto';
import { block, rigParts } from './rig.ts';
import { depthReading } from '../src/depthsheets.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

/** Two back chains, head + bang chain, and an independently weighted torso. */
export function weightedSurfaceFixture(surface = true) {
  const parts = rigParts();
  parts.rig_size = [64, 64]; parts.scale_rig_per_source = 1;
  parts.parts = [
    { ...parts.parts[0], name: 'hair_back', from: 'full:back hair', x: 16, y: 12, w: 32, h: 36, opaque_px: 32 * 36 },
    { ...parts.parts[0], name: 'hair_front', from: 'head:front hair', x: 18, y: 12, w: 28, h: 16, opaque_px: 28 * 16 },
    { ...parts.parts[0], name: 'topwear', from: 'full:topwear', x: 16, y: 38, w: 32, h: 20, opaque_px: 32 * 20 },
  ];
  const images = new Map<string, Raster>();
  for (const [i, p] of parts.parts.entries()) {
    const art = block(p.w, p.h), scalar = newRaster(p.w, p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const v = 60 + i * 25 + x + y;
      scalar.data.set([v, v, v, 255], (y * p.w + x) * 4);
    }
    p.depth = { image: `${p.name}_depth.png`, near: 'white', zScale: 40,
      sources: [{ from: p.from, image: 'scalar.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null) }] };
    images.set(p.name, art); images.set(p.depth.image, scalar);
  }
  const config: Record<string, unknown> = {
    key: 'weighted_surface',
    assemble: { rig_scale: 1, plan: [['hair_back', 'full', 'back hair'], ['hair_front', 'head', 'front hair'], ['topwear', 'full', 'topwear']] },
    bones: [
      { name: 'hip', parent: 'root', at: [32, 58] },
      { name: 'chest', parent: 'hip', at: [32, 44] },
      { name: 'head', parent: 'chest', at: [32, 36] },
      { chain: 'back_l', parent: 'head', points: [[22, 18], [22, 30]], tip: [22, 46] },
      { chain: 'back_r', parent: 'head', points: [[42, 18], [42, 30]], tip: [42, 46] },
      { chain: 'bang', parent: 'head', points: [[32, 14], [32, 20]], tip: [32, 27] },
      { chain: 'cloth', parent: 'chest', points: [[32, 40], [32, 48]], tip: [32, 57] },
    ],
    regions: {},
    meshes: {
      hair_back: { grid: 8, r: 20, segments: ['back_l', 'back_r'] },
      hair_front: { grid: 8, r: 20, segments: [['head', [32, 36], [32, 12]], 'bang'] },
      topwear: { grid: 8, r: 20, segments: [['chest', [32, 44], [32, 38]], 'cloth'] },
    },
    motion: { duration: 2, tracks: [{ bone: 'head', prop: 'rotate', amp: 3, period: 2, phase: 0 }, { bone: 'chest', prop: 'rotate', amp: 2, period: 2, phase: 0 }] },
    constraints: ['back_l0', 'back_l1', 'back_r0', 'back_r1', 'bang0', 'bang1', 'cloth0', 'cloth1'].map(bone => ({ type: 'physics', name: `${bone}_physics`, bone, rotate: 1, inertia: 1, strength: 30, damping: 0.8, mass: 1, wind: 0, gravity: 0, mix: 1 })),
    ...(surface ? { turn: { pivot: 20, counter: 0.1, grid: [5, 5], roles: { hair_back: 'surface', hair_front: 'surface' }, body: { pivot: 20, counter: 0.1, grid: [5, 5], roles: { topwear: 'surface' } } } } : {}),
  };
  return { config, parts, images };
}

/** Back surface < ears < face surface < front surface: draw order is explicit. */
export function weightedSurfaceEarFixture(earsAfterFace = false) {
  const f = weightedSurfaceFixture();
  const makePart = (name: string, from: string, x: number, y: number, w: number, h: number) => ({ ...f.parts.parts[0], name, from, x, y, w, h, opaque_px: w * h, depth: undefined });
  const right = makePart('ear_r', 'head:ears-r', 16, 24, 4, 6), left = makePart('ear_l', 'head:ears-l', 44, 24, 4, 6);
  const face = makePart('face', 'head:face', 20, 16, 24, 24), art = block(24, 24), scalar = newRaster(24, 24);
  for (let i = 0; i < 24 * 24; i++) scalar.data.set([120, 120, 120, 255], i * 4);
  const source = { ...f.parts.parts[0].depth!.sources[0], from: face.from, crop: [20, 16, 44, 40] as [number, number, number, number], sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), reading: depthReading(scalar, art, null) };
  const facePart = { ...face, depth: { image: 'face_depth.png', near: 'white' as const, zScale: 40, sources: [source] } };
  f.images.set('ear_r', block(4, 6)); f.images.set('ear_l', block(4, 6)); f.images.set('face', art); f.images.set('face_depth.png', scalar);
  const [back, front, torso] = f.parts.parts;
  f.parts.parts = earsAfterFace ? [back, facePart, right, left, front, torso] : [back, right, left, facePart, front, torso];
  (f.config.assemble as Record<string, unknown>).plan = f.parts.parts.map(p => [p.name, p.from.split(':')[0], p.from.split(':')[1]]);
  (f.config.bones as unknown[]).push({ name: 'ear_r', parent: 'head', at: [18, 27] }, { name: 'ear_l', parent: 'head', at: [46, 27] });
  f.config.regions = { ear_r: 'ear_r', ear_l: 'ear_l', face: 'head' };
  const turn = f.config.turn as { roles: Record<string, string>; unitDepths?: Record<string, number> };
  turn.roles.face = 'surface'; turn.roles.ear_r = 'unit'; turn.roles.ear_l = 'unit'; turn.unitDepths = { ear_r: -4, ear_l: -4 };
  return f;
}
