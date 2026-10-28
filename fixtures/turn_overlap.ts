/** Flat sloping neck rim tucked into a body-only plate; no private artwork. */
import { createHash } from 'node:crypto';
import { blendedTurnFixture } from './turn_blend.ts';
import { block } from './rig.ts';
import { explicitImageHash, explicitRegionHash } from '../src/explicitmesh.ts';
import { depthReading } from '../src/depthsheets.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import type { ExplicitMeshIslandSpec } from '../src/config.ts';

export function overlapTurnFixture() {
  const f = blendedTurnFixture();
  Object.assign(f.parts.parts[0], { x: 20, y: 40, w: 32, h: 20 });
  Object.assign(f.parts.parts[1], { x: 20, y: 20, w: 32, h: 32 });
  Object.assign(f.parts.parts[2], { x: 24, y: 4, w: 16, h: 10 });
  const meshes: Record<string, unknown> = {};
  for (const p of f.parts.parts) {
    const art = block(p.w, p.h), scalar = block(p.w, p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      if (p.name !== 'face' && x < Math.floor((p.y + y - 20) / 2)) art.data.fill(0, (y * p.w + x) * 4, (y * p.w + x + 1) * 4);
      scalar.data.set([120, 120, 120, 255], (y * p.w + x) * 4);
    }
    p.opaque_px = Array.from(art.data).filter((v, i) => i % 4 === 3 && v === 255).length;
    p.depth = { image: `${p.name}_depth.png`, near: 'white', zScale: 40, sources: [{ from: p.from, image: 'scalar.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null) }] };
    f.images.set(p.name, art); f.images.set(p.depth.image, scalar);
    if (p.name === 'face') continue;
    const rows = p.name === 'neck' ? [20.5, 30.5, 40.5, 50.5] : [40.25, 50.5, 58.5];
    // A quarter source pixel of coverage keeps the normal control strictly
    // inside its neighbour; exact boundary ownership has separate controls.
    const points = [...rows.map(y => [20.5 + Math.floor((y - 20) / 2) - (p.name === 'neck' ? 0 : 0.25), y]), ...rows.toReversed().map(y => [p.name === 'neck' ? 51.5 : 51.75, y])];
    const triangles = rows.slice(1).flatMap((_, i) => [i, i + 1, 2 * rows.length - 2 - i, i, 2 * rows.length - 2 - i, 2 * rows.length - 1 - i]);
    meshes[p.name] = { segments: p.name === 'neck' ? ['torso', 'crown'] : ['torso'], explicit: {
      image_sha256: explicitImageHash(art), region_sha256: explicitRegionHash(f.parts.rig_size, p),
      uvs: points.flatMap(([x, y]) => [(x - p.x + 4) / (p.w + 8), (y - p.y + 4) / (p.h + 8)]), triangles, hull: points.length,
      weights: points.map(([x, y]) => [{ bone: 'torso', x: x - 32, y: 50 - y, weight: p.name === 'neck' ? 0.6 : 1 }, ...(p.name === 'neck' ? [{ bone: 'crown', x: x - 32, y: 24 - y, weight: 0.4 }] : [])]),
    } };
  }
  f.config.meshes = meshes;
  f.config.regions = { face: 'crown' };
  return f;
}

/** Different affine depth field, with the inspected art edge inside both meshes. */
export function differingDepthTurnFixture() {
  const f = overlapTurnFixture(), neighbour = f.parts.parts[0];
  const oldWidth = neighbour.w; neighbour.w = 40;
  const art = block(neighbour.w, neighbour.h), scalar = block(neighbour.w, neighbour.h);
  for (const p of [f.parts.parts[1], neighbour]) {
    const image = p === neighbour ? art : f.images.get(p.name)!;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const cy = p.y + y, left = Math.floor((cy - 20) / 2) + (cy >= 42 && cy <= 48 ? 3 : 0);
      image.data[(y * image.width + x) * 4 + 3] = x < left ? 0 : 255;
    }
    p.opaque_px = Array.from(image.data).filter((v, i) => i % 4 === 3 && v === 255).length;
  }
  for (let y = 0; y < scalar.height; y++) for (let x = 0; x < scalar.width; x++) scalar.data.set([20 + 5 * x, 20 + 5 * x, 20 + 5 * x, 255], (y * scalar.width + x) * 4);
  f.images.set(neighbour.name, art); f.images.set(neighbour.depth!.image, scalar);
  neighbour.depth = { ...neighbour.depth!, sources: [{ from: neighbour.from, image: 'affine-scalar.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [neighbour.x, neighbour.y, neighbour.x + neighbour.w, neighbour.y + neighbour.h], reading: depthReading(scalar, art, null) }] };
  const meshes = f.config.meshes as Record<string, { explicit: Pick<ExplicitMeshIslandSpec, 'uvs'> & { image_sha256: string; region_sha256: string } }>;
  meshes.topwear.explicit.uvs = meshes.topwear.explicit.uvs.map((v, i) => i % 2 === 0 ? v * (oldWidth + 8) / (neighbour.w + 8) : v);
  for (const p of [f.parts.parts[1], neighbour]) {
    meshes[p.name].explicit.image_sha256 = explicitImageHash(f.images.get(p.name)!);
    meshes[p.name].explicit.region_sha256 = explicitRegionHash(f.parts.rig_size, p);
  }
  return f;
}

/** Independent carrier avoids reparenting the blended target's own torso frame. */
export function roleNeighbourTurnFixture(role: 'unit' | 'rear', islands: 'overlap' | 'disconnected' | 'none' = 'none', group: 'head' | 'body' = 'body') {
  const f = overlapTurnFixture();
  (f.config.bones as unknown[]).push({ name: 'plate', parent: group === 'head' ? 'head' : 'chest', at: [32, 50] });
  const mesh = (f.config.meshes as Record<string, { segments: string[]; explicit: Pick<ExplicitMeshIslandSpec, 'weights' | 'uvs' | 'triangles' | 'hull'> & { image_sha256: string; region_sha256: string } }>).topwear;
  mesh.segments = ['plate']; mesh.explicit.weights.forEach(row => row.forEach(w => { w.bone = 'plate'; }));
  (f.config.turn as { body: { roles: Record<string, string> } }).body.roles.topwear = role;
  (f.config.turn as { body: { roles: Record<string, string> } }).body.roles.neck = 'surface';
  if (group === 'head') { const turn = f.config.turn as { roles: Record<string, string>; body: { roles: Record<string, string> } }; delete turn.body.roles.topwear; turn.roles.topwear = role; }
  if (islands !== 'none') {
    const bounds = islands === 'overlap' ? [[30.25, 36], [46, 51.75]] : [[38, 42], [44, 48]];
    const p = f.parts.parts[0];
    const art = f.images.get(p.name)!;
    for (let y = 0; y < art.height; y++) for (let x = 22; x <= 25; x++) art.data[(y * art.width + x) * 4 + 3] = 0;
    p.opaque_px = Array.from(art.data).filter((v, i) => i % 4 === 3 && v === 255).length;
    const payload = bounds.map(([left, right], i) => {
      const points = [[left, 40.25], [left, 51], [right, 51], [right, 40.25]];
      return { slot: i === 0 ? 'topwear' : 'topwear__island2', bone: 'plate', hull: 4, triangles: [0, 1, 2, 0, 2, 3],
        uvs: points.flatMap(([x, y]) => [(x - p.x + 4) / (p.w + 8), (y - p.y + 4) / (p.h + 8)]),
        weights: points.map(([x, y]) => [{ bone: 'plate', x: x - 32, y: 50 - y, weight: 1 }]),
      };
    });
    (f.config.meshes as Record<string, unknown>).topwear = { segments: ['plate'], explicit: { image_sha256: explicitImageHash(art), region_sha256: mesh.explicit.region_sha256, islands: payload } };
  }
  return f;
}
