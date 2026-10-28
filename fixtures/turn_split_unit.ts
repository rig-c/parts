/** Blink-still unit support with independent upper/lower rigid depths. */
import { roleNeighbourTurnFixture } from './turn_overlap.ts';
import type { ExplicitMeshIslandSpec } from '../src/config.ts';

export function splitUnitNeighbourTurnFixture() {
  const f = roleNeighbourTurnFixture('unit');
  delete (f.config.meshes as Record<string, unknown>).topwear;
  (f.config.regions as Record<string, string>).topwear = 'plate';
  (f.config.bones as unknown[]).push({ name: 'cap', parent: 'chest', at: [35, 43] });
  const p = f.parts.parts[0], art = f.images.get(p.name)!;
  // The real reader requires a clear cut row; two opaque pieces remain.
  for (let x = 0; x < art.width; x++) art.data[(6 * art.width + x) * 4 + 3] = 0;
  p.opaque_px = Array.from(art.data).filter((v, i) => i % 4 === 3 && v === 255).length;
  const motion = f.config.motion as Record<string, unknown>;
  motion.blink = { t: 1, eyes: ['plate'], squash: 0.12, still: { topwear: { row: 46, bone: 'cap' } } };
  (f.config.turn as { body: { unitDepths?: Record<string, number> } }).body.unitDepths = { plate: 24, cap: 9 };
  // Extra rows on either side of the cut expose padded-support overlap.
  const rows = [20.5, 30.5, 40.5, 43.5, 45.5, 46.5, 47.5, 50.5];
  const points = [...rows.map(y => [20.5 + Math.floor((y - 20) / 2), y]), ...rows.toReversed().map(y => [51.5, y])];
  const mesh = (f.config.meshes as Record<string, { explicit: ExplicitMeshIslandSpec }>).neck.explicit;
  mesh.weights = points.map(([x, y]) => [{ bone: 'torso', x: x - 32, y: 50 - y, weight: 0.6 }, { bone: 'crown', x: x - 32, y: 24 - y, weight: 0.4 }]);
  mesh.uvs = points.flatMap(([x, y]) => [(x - 16) / 40, (y - 16) / 40]);
  mesh.triangles = rows.slice(1).flatMap((_, i) => [i, i + 1, 2 * rows.length - 2 - i, i, 2 * rows.length - 2 - i, 2 * rows.length - 1 - i]);
  mesh.hull = points.length;
  return f;
}
