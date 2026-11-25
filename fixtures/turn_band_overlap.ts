/** A collar band on a torso part that other turn parts overlap (#1543); flat colour blocks, no private artwork. */
import { createHash } from 'node:crypto';
import { block, rigParts } from './rig.ts';
import { depthReading } from '../src/depthsheets.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import type { Raster } from '../src/raster/index.ts';

/**
 * Canvas 64x96, chin line y = 30, band 8 px (y 30..38), every sheet zScale 40.
 * - `single`: no band; the torso is a body-only surface.
 * - `band-depth`: band; face (flat) and fringe (ramp) over the pure-head collar rows,
 *   coat (flat) and glove (ramp) over pure-body torso rows below the band.
 * - `band-groups`: the back hair (head, ramp) also hangs over the torso's left edge,
 *   across the band and over the coat.
 * - `scarf-behind` / `scarf-front`: `band-depth` plus a body-group scarf (ramp sheet)
 *   opaque over the open band at x 34..46, drawn behind the torso / in front of it.
 * - `rim-depth` / `rim-groups`: `band-depth` / `band-groups` with no region declared;
 *   the torso mixes into the head group through a second `collar` segment (32,34)-(32,10)
 *   instead, #806's undeclared shape, so the covers still own it and refuse.
 */
export type BandOverlapVariant = 'single' | 'band-depth' | 'band-groups' | 'scarf-behind' | 'scarf-front' | 'rim-depth' | 'rim-groups';

export const BAND_OVERLAP = { height: 96, chin: 30, band: 8, headPivot: 16, bodyPivot: 24 } as const;

export function bandOverlapTurnFixture(v: BandOverlapVariant) {
  const hairClear = v !== 'band-groups' && v !== 'rim-groups';
  const rim = v === 'rim-depth' || v === 'rim-groups';
  const boxes: Array<[string, string, number, number, number, number, 'flat' | 'ramp']> = [
    ['topwear', 'full:topwear', 16, 10, 32, 80, 'flat'],
    ['face', 'head:face', 22, 4, 20, 26, 'flat'],
    ['fringe', 'head:front hair', 22, 4, 20, 12, 'ramp'],
    ['hairback', 'head:back hair', hairClear ? 4 : 10, 4, 10, 56, 'ramp'],
    ['coat', 'full:bottomwear', 16, 44, 14, 46, 'flat'],
    ['glove', 'full:handwear-r', 22, 60, 12, 12, 'ramp'],
  ];
  // Plan order is draw order, back to front: the scarf goes before or after the torso.
  const scarf: (typeof boxes)[number] = ['scarf', 'full:neckwear', 34, 26, 12, 14, 'ramp'];
  if (v === 'scarf-behind') boxes.unshift(scarf);
  if (v === 'scarf-front') boxes.splice(1, 0, scarf);
  const parts = rigParts(), template = parts.parts[0];
  parts.rig_size = [64, BAND_OVERLAP.height]; parts.scale_rig_per_source = 1;
  parts.parts = boxes.map(([name, from, x, y, w, h]) => ({ ...template, name, from, x, y, w, h, opaque_px: w * h }));
  const images = new Map<string, Raster>();
  for (const [i, p] of parts.parts.entries()) {
    const art = block(p.w, p.h), scalar = block(p.w, p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const level = boxes[i][6] === 'ramp' ? Math.min(255, 20 + 5 * x) : 120;
      scalar.data.set([level, level, level, 255], 4 * (y * p.w + x));
    }
    p.depth = { image: `${p.name}_depth.png`, near: 'white', zScale: 40, sources: [{ from: p.from, image: 'scalar.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null) }] };
    images.set(p.name, art); images.set(p.depth.image, scalar);
  }
  const { chin, band } = BAND_OVERLAP;
  const contour: Record<string, unknown> = { tolerance: 0, margin: 0, spacing: 4 };
  if (v !== 'single' && !rim) contour.regions = [{ name: 'collar', shape: 'polygon', points: [[12, 2], [52, 2], [52, chin], [12, chin]], bone: 'collar', spacing: 2, band }];
  const config: Record<string, unknown> = {
    key: 'band_overlap',
    assemble: { rig_scale: 1, plan: parts.parts.map(p => [p.name, ...p.from.split(':')]) },
    bones: [
      { name: 'chest', parent: 'root', at: [32, 90] },
      { name: 'torso', parent: 'chest', at: [32, 90] },
      { name: 'head', parent: 'chest', at: [32, chin] },
      { name: 'crown', parent: 'head', at: [32, chin] },
      { name: 'collar', parent: 'head', at: [32, chin], inherit: 'onlyTranslation' },
    ],
    regions: { face: 'crown', fringe: 'crown', hairback: 'crown', coat: 'torso', glove: 'torso', ...(v.startsWith('scarf') ? { scarf: 'torso' } : {}) },
    meshes: { topwear: { segments: [['torso', [32, 90], [32, 34]], ...(rim ? [['collar', [32, 34], [32, 10]]] : [])], r: 4, contour } },
    motion: { duration: 2, tracks: [{ bone: 'chest', prop: 'rotate', amp: 2, period: 2, phase: 0 }] },
    turn: {
      pivot: BAND_OVERLAP.headPivot, grid: [5, 5],
      roles: { face: 'surface', fringe: 'surface', hairback: 'surface' },
      body: { pivot: BAND_OVERLAP.bodyPivot, roles: { topwear: 'surface', coat: 'surface', glove: 'surface', ...(v.startsWith('scarf') ? { scarf: 'surface' as const } : {}) } },
    },
  };
  return { config, parts, images };
}
