/** A flat neck joining two opaque plates; weights, depth and overlap are authored. */
import { createHash } from 'node:crypto';
import { assemble, singleRunHeadBox } from '../src/assemble.ts';
import type { LayerSet } from '../src/layers.ts';
import { readLayerTag } from '../src/tags.ts';
import type { ExplicitMeshIslandSpec } from '../src/config.ts';
import { newRaster } from '../src/raster/types.ts';
import { block, rigParts } from './rig.ts';
import { explicitImageHash, explicitRegionHash } from '../src/explicitmesh.ts';
import { depthReading } from '../src/depthsheets.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import type { Raster } from '../src/raster/types.ts';

export function blendedTurnFixture(role: 'surface' | 'none' | 'unit' = 'surface') {
  const parts = rigParts(), template = parts.parts[0];
  parts.rig_size = [64, 64]; parts.scale_rig_per_source = 1;
  parts.parts = [
    { ...template, name: 'topwear', from: 'full:topwear', x: 24, y: 42, w: 16, h: 18, opaque_px: 288 },
    { ...template, name: 'neck', from: 'head:neck', x: 24, y: 24, w: 16, h: 20, opaque_px: 320 },
    { ...template, name: 'face', from: 'head:face', x: 24, y: 12, w: 16, h: 14, opaque_px: 224 },
  ];
  const images = new Map<string, Raster>();
  for (const p of parts.parts) {
    const art = block(p.w, p.h), scalar = block(p.w, p.h);
    for (let i = 0; i < p.w * p.h; i++) scalar.data.set([120, 120, 120, 255], 4 * i);
    p.depth = { image: `${p.name}_depth.png`, near: 'white', zScale: 40, sources: [{ from: p.from, image: 'scalar.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null) }] };
    images.set(p.name, art); images.set(p.depth.image, scalar);
  }
  const neck = parts.parts[1];
  // PAD4: (20,20)..(44,48). Hull first, then the three middle-row points.
  const points = [[20,20],[20,28],[20,34],[20,40],[20,48],[32,48],[44,48],[44,40],[44,34],[44,28],[44,20],[32,20],[32,28],[32,34],[32,40]];
  const index = (x: number, y: number) => points.findIndex(p => p[0] === x && p[1] === y);
  const triangles: number[] = [];
  for (const [y0,y1] of [[20,28],[28,34],[34,40],[40,48]]) for (const [x0,x1] of [[20,32],[32,44]]) {
    const a=index(x0,y0),b=index(x0,y1),c=index(x1,y1),d=index(x1,y0); triangles.push(a,b,c,a,c,d);
  }
  const config: Record<string, unknown> = {
    key: 'blended_turn', assemble: { rig_scale: 1, plan: parts.parts.map(p => [p.name, ...p.from.split(':')]) },
    bones: [
      { name: 'chest', parent: 'root', at: [32,50] },
      { name: 'torso', parent: 'chest', at: [32,50] },
      { name: 'head', parent: 'chest', at: [32,24] },
      { name: 'crown', parent: 'head', at: [32,24] },
    ],
    regions: { topwear: 'torso', face: 'crown' },
    meshes: { neck: { segments: ['torso','crown'], explicit: {
      image_sha256: explicitImageHash(images.get('neck')!), region_sha256: explicitRegionHash(parts.rig_size,neck),
      uvs: points.flatMap(([x,y]) => [(x-20)/24,(y-20)/28]), triangles, hull: 12,
      weights: points.map(([x,y]) => {
        const body = y <= 28 ? 0 : y >= 40 ? 1 : 0.7;
        return [...(body === 0 ? [] : [{ bone: 'torso', x:x-32,y:50-y,weight:body }]), ...(body === 1 ? [] : [{ bone:'crown',x:x-32,y:24-y,weight:1-body }])];
      }),
    } } },
    motion: { duration: 2, tracks: [{bone:'chest',prop:'rotate',amp:2,period:2,phase:0}] },
    constraints: [{type:'physics',name:'crown_physics',bone:'crown',x:1,inertia:1,strength:30,damping:0.8,mass:1,wind:0,gravity:0,mix:1}],
    turn: { pivot:16, grid:[5,5], roles:{face:'surface',...(role === 'none' ? {} : {neck:role})}, body:{pivot:24,grid:[5,5],roles:{topwear:'surface'}} },
  };
  return {config,parts,images};
}

/** Actual assembly of three disconnected 4x20 blocks, then an accepted island payload. */
export function blendedTurnIslandsFixture() {
  const f = blendedTurnFixture();
  const neckArt = f.images.get('neck')!;
  for (let y = 0; y < neckArt.height; y++) for (const x of [4, 5, 10, 11]) neckArt.data.fill(0, (y * neckArt.width + x) * 4, (y * neckArt.width + x + 1) * 4);
  // Separate the partner plates so assembly cannot project their art into the island gaps.
  Object.assign(f.parts.parts[0], { y: 48, h: 12, opaque_px: 192 });
  Object.assign(f.parts.parts[2], { y: 8, h: 12, opaque_px: 192 });
  f.images.set('topwear', block(16, 12)); f.images.set('face', block(16, 12));
  const source = newRaster(64, 64);
  for (let i = 0; i < 64 * 64; i++) source.data.set([255, 255, 255, 255], i * 4);
  const full: LayerSet = { form: 'wrapper', source: 'synthetic layers', canvas: { w: 64, h: 64 }, hidden: [], layers: f.parts.parts.map((p, drawOrder) => {
    const pixels = f.images.get(p.name)!, name = p.from.split(':')[1];
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const at = (y * p.w + x) * 4;
      if (pixels.data[at + 3] > 0) source.data.set(pixels.data.subarray(at, at + 4), ((p.y + y) * 64 + p.x + x) * 4);
    }
    return { name, tag: readLayerTag(name)!, file: null, pixels, left: p.x, top: p.y, right: p.x + p.w, bottom: p.y + p.h, depth: 1 - drawOrder / 4, drawOrder, opaquePx: p.name === 'neck' ? 240 : p.w * p.h };
  }) };
  const plan: Array<[string, 'full', string]> = f.parts.parts.map(p => [p.name, 'full', p.from.split(':')[1]]);
  const assembled = assemble({ source, full, head: full, resolution: 64, headBox: singleRunHeadBox(64, 64), rigScale: 1, plan, extend: [], patches: [], cuts: [], seamRule: 'near-white', projectRule: 'visible' });
  f.parts = assembled.parts;
  f.images = new Map(assembled.images.map(p => [p.record.name, p.image]));
  // Standalone authored sheets bind the actual assembled rectangles and decoded art.
  for (const p of f.parts.parts) {
    const art = f.images.get(p.name)!, scalar = block(p.w, p.h);
    for (let i = 0; i < p.w * p.h; i++) scalar.data.set([120, 120, 120, 255], i * 4);
    p.depth = { image: `${p.name}_depth.png`, near: 'white', zScale: 40, sources: [{ from: p.from, image: 'scalar.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null) }] };
    f.images.set(p.depth.image, scalar);
  }
  const part = f.parts.parts.find(p => p.name === 'neck')!;
  const islands: ExplicitMeshIslandSpec[] = [0, 6, 12].map((left, i) => {
    const points = [[part.x + left, part.y], [part.x + left, part.y + part.h], [part.x + left + 4, part.y + part.h], [part.x + left + 4, part.y]];
    return { slot: i === 0 ? 'neck' : `neck__island${i + 1}`, bone: i === 1 ? 'crown' : 'torso',
      uvs: points.flatMap(([x, y]) => [(x - part.x + 4) / (part.w + 8), (y - part.y + 4) / (part.h + 8)]), triangles: [0, 1, 2, 0, 2, 3], hull: 4,
      weights: points.map(([x, y]) => i === 0
        ? [{ bone: 'torso', x: x - 32, y: 50 - y, weight: 0.7 }, { bone: 'crown', x: x - 32, y: 24 - y, weight: 0.3 }]
        : [{ bone: i === 1 ? 'crown' : 'torso', x: x - 32, y: (i === 1 ? 24 : 50) - y, weight: 1 }]),
    };
  });
  f.config.assemble = { rig_scale: 1, plan };
  f.config.meshes = { neck: { segments: ['torso', 'crown'], explicit: { image_sha256: explicitImageHash(f.images.get('neck')!), region_sha256: explicitRegionHash(f.parts.rig_size, part), islands } } };
  return { ...f, islands };
}

/** A single-group part, optionally naming the other subtree at weight zero. */
export function singleGroupTurnFixture(group: 'head' | 'body', role: 'head' | 'body', zero = false) {
  const f = blendedTurnFixture();
  const mesh = (f.config.meshes as Record<string, { explicit: { weights: ExplicitMeshIslandSpec['weights'] } }>).neck;
  mesh.explicit.weights = mesh.explicit.weights.map(row => {
    const x = row.reduce((s, w) => s + w.x * w.weight, 0);
    const cy = row.reduce((s, w) => s + ((w.bone === 'torso' ? 50 : 24) - w.y) * w.weight, 0);
    return [{ bone: group === 'head' ? 'crown' : 'torso', x, y: (group === 'head' ? 24 : 50) - cy, weight: 1 },
      ...(zero ? [{ bone: group === 'head' ? 'torso' : 'crown', x, y: (group === 'head' ? 50 : 24) - cy, weight: 0 }] : [])];
  });
  f.config.turn = { pivot: 16, roles: { face: 'surface', ...(role === 'head' ? { neck: 'surface' } : {}) }, body: { pivot: 24, roles: { topwear: 'surface', ...(role === 'body' ? { neck: 'surface' } : {}) } } };
  return f;
}
