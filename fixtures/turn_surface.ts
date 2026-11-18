/** Flat blocks with independent scalar ramps; no character artwork. */
import { createHash } from 'node:crypto';
import { block, rigParts } from './rig.ts';
import { depthReading } from '../src/depthsheets.ts';
import { floatBox, integrateNormals, mapToSheet } from '../src/depthmaps.ts';
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

/** Abutting opaque rectangles: levels 40..100 and 104..164, medians 70 and 134. */
export function abuttingSurfaceFixture(group: 'head' | 'body', authored: boolean, eyes = false) {
  const f = weightedSurfaceFixture();
  const names = group === 'head' ? ['face', 'hair_front'] : ['topwear', 'bottomwear'];
  const bone = group === 'head' ? 'head' : 'chest';
  f.parts.parts = names.map((name, i) => ({ ...f.parts.parts[0], name,
    from: `${group === 'head' ? 'head' : 'full'}:${name === 'hair_front' ? 'front hair' : name}`,
    x: 16, y: 12 + i * 16, w: 32, h: 16, opaque_px: 32 * 16 }));
  f.images.clear();
  for (const [i, p] of f.parts.parts.entries()) {
    const art = block(p.w, p.h), scalar = newRaster(p.w, p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const v = 40 + 64 * i + 4 * y;
      scalar.data.set([v, v, v, 255], (y * p.w + x) * 4);
    }
    p.depth = { image: `${p.name}_depth.png`, near: 'white', zScale: 40,
      sources: [{ from: p.from, image: 'scalar.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null) }] };
    f.images.set(p.name, art); f.images.set(p.depth.image, scalar);
  }
  (f.config.assemble as Record<string, unknown>).plan = f.parts.parts.map(p => [p.name, p.from.split(':')[0], p.from.split(':')[1]]);
  f.config.regions = authored ? {} : Object.fromEntries(names.map(name => [name, bone]));
  f.config.meshes = authored ? Object.fromEntries(names.map(name => [name,
    { grid: 4, r: 20, segments: [[bone, [32, 44], [32, 12]]] }])) : {};
  // Reverse declaration order in the head: face preference must beat first surface.
  const roles = Object.fromEntries((group === 'head' ? [...names].reverse() : names).map(name => [name, 'surface']));
  f.config.turn = group === 'head' ? { pivot: 20, grid: [5, 5], roles } : { body: { pivot: 20, grid: [5, 5], roles } };
  if (eyes) (f.config.bones as unknown[]).push(
    { name: 'eye_r', parent: 'head', at: [24, 16] },
    { name: 'eye_l', parent: 'head', at: [40, 16] },
  );
  return f;
}

/** Mixed providers on the existing opaque rectangles; all calibration derives
 * from their shared zScale. The face integrates a spherical normal field;
 * back hair reads a scalar ramp in unrelated raw units. No private input.
 */
export function mixedDepthSurfaceFixture(authored: boolean, inFront = false, reparameterized = false) {
  const f = abuttingSurfaceFixture('head', authored);
  const back = f.parts.parts[1];
  back.name = 'hair_back'; back.from = 'full:back hair';
  const zScale = back.depth!.zScale, pivot = zScale / 2;
  f.config.regions = authored ? {} : { face: 'head', hair_back: 'head' };
  f.config.meshes = authored ? Object.fromEntries(['face', 'hair_back'].map(name => [name,
    { grid: 4, r: 20, segments: [['head', [32, 44], [32, 12]]] }])) : {};
  f.config.turn = { pivot, grid: [5, 5], roles: { hair_back: 'surface', face: 'surface' } };
  (f.config.assemble as Record<string, unknown>).plan = f.parts.parts.map(p => [p.name, p.from.split(':')[0], p.from.split(':')[1]]);
  f.images.clear();
  const declarations = [];
  for (const [i, p] of f.parts.parts.entries()) {
    const art = block(p.w, p.h), raw: number[] = [];
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      if (i === 0) {
        const nx = (x - p.w / 2) / p.w, ny = (y - p.h / 2) / p.w;
        raw.push(nx, ny, Math.sqrt(1 - nx * nx - ny * ny));
      } else raw.push((x + y) / zScale);
    }
    const integrated = i === 0 ? integrateNormals({ spec: 'rig-parts-map/1', width: p.w, height: p.h, channels: 3, data: raw }, art, p.name) : undefined;
    // Every stride-two integration sample is supported: extension is identity.
    let values: ArrayLike<number> = integrated === undefined ? raw : floatBox(integrated.data, Math.ceil(p.w / 2), Math.ceil(p.h / 2), p.w, p.h);
    if (reparameterized) values = Array.from(values, v => v * zScale + p.w);
    const median = i === 0 ? zScale * 3 / 4 : inFront ? zScale - zScale / 8 : zScale / 4;
    const relief = zScale / 8;
    const { sheet, reading } = mapToSheet(values, art, median, relief, 'white', zScale, p.name);
    p.depth = { image: `${p.name}_depth.png`, near: 'white', zScale,
      sources: [{ from: p.from, image: i === 0 ? 'normal-map.json' : 'scalar-map.json', sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex'), crop: [0, 0, p.w, p.h], reading: depthReading(sheet, art, null) }] };
    f.images.set(p.name, art); f.images.set(p.depth.image, sheet);
    declarations.push({ part: p.name, source: integrated === undefined ? 'depth' : 'normals', median, relief, ...reading });
  }
  return { ...f, declarations };
}

/** Three abutting body sheets: an upper descending ramp and two ascending ramps.
 * Upper/sleeve share a top level, sleeve/lower differ by one four-level step.
 * All numbers are synthetic levels; no consumer art or measured depths enter here.
 */
export function sleeveSurfaceFixture(authored: boolean) {
  const f = abuttingSurfaceFixture('body', authored);
  const names = ['topwear', 'sleeve', 'bottomwear'];
  f.parts.parts = names.map((name, i) => ({ ...f.parts.parts[0], name, from: `full:${name === 'sleeve' ? 'author:sleeve' : name}`, y: 12 + i * 16 }));
  f.images.clear();
  for (const [i, p] of f.parts.parts.entries()) {
    const art = block(p.w, p.h), scalar = newRaster(p.w, p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const v = i === 0 ? 104 - 4 * y : 40 + 64 * i + 4 * y;
      scalar.data.set([v, v, v, 255], (y * p.w + x) * 4);
    }
    p.depth = { image: `${p.name}_depth.png`, near: 'white', zScale: 40,
      sources: [{ from: p.from, image: 'scalar.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null) }] };
    f.images.set(p.name, art); f.images.set(p.depth.image, scalar);
  }
  (f.config.assemble as Record<string, unknown>).plan = names.map(name => [name, 'full', name === 'sleeve' ? 'author:sleeve' : name]);
  f.config.regions = authored ? {} : Object.fromEntries(names.map(name => [name, 'chest']));
  f.config.meshes = authored ? Object.fromEntries(names.map(name => [name,
    { grid: 4, r: 20, segments: [['chest', [32, 44], [32, 12]]] }])) : {};
  f.config.turn = { body: { pivot: 20, grid: [5, 5], roles: Object.fromEntries(names.map(name => [name, 'surface'])) } };
  return f;
}
