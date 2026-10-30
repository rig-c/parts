/** Public flat blocks isolating explicit and primary-surface unit depth precedence. */
import { createHash } from 'node:crypto';
import { unitSupportTurnFixture } from './turn_units.ts';
import { depthReading } from '../src/depthsheets.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

export const UNIT_PRECEDENCE_MODES = ['part-low', 'part-high', 'bone-low', 'bone-high', 'surface-low', 'surface-high', 'surface-changed'] as const;
export type UnitPrecedenceMode = typeof UNIT_PRECEDENCE_MODES[number];
interface RawTurn { roles: Record<string, string>; depths?: Record<string, number>; unitDepths?: Record<string, number> }

/** The unit parts and bones deliberately have different names; alpha masks never change. */
export function unitPrecedenceFixture(mode: UnitPrecedenceMode) {
  const f = unitSupportTurnFixture('inside');
  const turn = f.config.turn as RawTurn;
  delete turn.depths;
  const regions = f.config.regions as Record<string, string>;
  for (const b of f.config.bones as Array<{ name?: string }>) {
    if (b.name === 'token_r' || b.name === 'token_l') b.name += '_bone';
  }
  for (const [name, colour] of [['token_r', [235, 55, 65]], ['token_l', [30, 150, 235]]] as const) {
    regions[name] = `${name}_bone`;
    const p = f.parts.parts.find(p => p.name === name)!;
    const art = f.images.get(name)!;
    const scalar = newRaster(p.w, p.h);
    const level = mode.endsWith('high') ? 220 : 40;
    for (let i = 0; i < p.w * p.h; i++) {
      art.data.set([...colour, art.data[4 * i + 3]], 4 * i);
      scalar.data.set([level, level, level, 255], 4 * i);
    }
    p.depth = { image: `${name}_depth.png`, near: 'white', zScale: 40, sources: [{ from: p.from, image: 'analytic_unit.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null) }] };
    f.images.set(p.depth.image, scalar);
  }
  if (mode.startsWith('part-')) turn.unitDepths = { token_r: 0, token_l: 8, token_r_bone: -4, token_l_bone: -4 };
  else if (mode.startsWith('bone-')) turn.unitDepths = { token_r_bone: 0, token_l_bone: 8 };
  else delete turn.unitDepths;
  if (mode === 'surface-changed') {
    const scalar = f.images.get('face_depth.png')!;
    for (let y = 0; y < scalar.height; y++) for (let x = 0; x < scalar.width; x++) {
      const level = 40 + 4 * (scalar.width - 1 - x);
      scalar.data.set([level, level, level, 255], 4 * (y * scalar.width + x));
    }
    const p = f.parts.parts.find(p => p.name === 'face')!;
    p.depth!.sources[0] = { ...p.depth!.sources[0], sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), reading: depthReading(scalar, f.images.get('face')!, null) };
  }
  return f;
}
