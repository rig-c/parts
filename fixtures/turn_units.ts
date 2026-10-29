/** Public flat blocks: mirrored unit bones over an asymmetric surface ramp. */
import { createHash } from 'node:crypto';
import { depthReading } from '../src/depthsheets.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { weightedSurfaceEarFixture } from './turn_surface.ts';

export function asymmetricUnitTurnFixture(explicit = true) {
  const f = weightedSurfaceEarFixture();
  const sheet = f.images.get('face_depth.png')!;
  for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) {
    const level = 40 + 4 * x;
    sheet.data.set([level, level, level, 255], (y * sheet.width + x) * 4);
  }
  const face = f.parts.parts.find(p => p.name === 'face')!;
  face.depth!.sources[0] = { ...face.depth!.sources[0], sha256: createHash('sha256').update(encodePngBytes(sheet)).digest('hex'), reading: depthReading(sheet, f.images.get('face')!, null) };
  const turn = f.config.turn as { unitDepths?: Record<string, number>; depths?: Record<string, number> };
  // Legacy layer-order depths are equal, but are not sampled-turn overrides.
  turn.depths = { face: 0.5, ear_r: 0.65625, ear_l: 0.65625 };
  if (!explicit) delete turn.unitDepths;
  return f;
}

/** Generic tokens test support independently of ear-specific cheek refusals. */
export function unitSupportTurnFixture(support: 'inside' | 'edge' | 'outside' | 'transparent' | 'fringe' = 'inside', explicit = false) {
  const f = asymmetricUnitTurnFixture(explicit);
  const rename = (name: string) => name === 'ear_r' ? 'token_r' : name === 'ear_l' ? 'token_l' : name;
  for (const p of f.parts.parts) {
    const old = p.name;
    p.name = rename(old);
    if (old !== p.name) { f.images.set(p.name, f.images.get(old)!); f.images.delete(old); }
  }
  (f.config.assemble as { plan: string[][] }).plan = f.parts.parts.map(p => [p.name, ...p.from.split(':')]);
  f.config.regions = { token_r: 'token_r', token_l: 'token_l', face: 'head' };
  for (const b of f.config.bones as Array<{ name?: string; at?: number[] }>) {
    if (b.name === 'ear_r' || b.name === 'ear_l') {
      const right = b.name === 'ear_r'; b.name = rename(b.name);
      b.at = [support === 'outside' ? (right ? 18 : 46) : support === 'edge' ? (right ? 20 : 43) : (right ? 22 : 41), 27];
    }
  }
  const turn = f.config.turn as { roles: Record<string, string>; depths: Record<string, number>; unitDepths?: Record<string, number> };
  for (const name of ['roles', 'depths', 'unitDepths'] as const) {
    const table = turn[name];
    if (table !== undefined) for (const old of ['ear_r', 'ear_l']) {
      if (Object.hasOwn(table, old)) { Object.assign(table, { [rename(old)]: table[old] }); delete table[old]; }
    }
  }
  if (support === 'transparent' || support === 'fringe') {
    const art = f.images.get('face')!;
    for (const x of [2, 21]) art.data[(11 * art.width + x) * 4 + 3] = support === 'transparent' ? 0 : 127;
  }
  return f;
}
