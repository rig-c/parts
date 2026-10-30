/** Flat public art with a structural under-fill outside the retained parent material. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CharacterConfig } from '../src/config.ts';
import { writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

function solid(w: number, h: number, rgba: readonly number[]) {
  const r = newRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set(rgba, i * 4);
  return r;
}

export function authoredUnitDepthFixture(dir: string): CharacterConfig {
  mkdirSync(dir, { recursive: true });
  const source = solid(64, 64, [240, 240, 240, 255]);
  const rows = [
    { name: 'face', x: 20, y: 6, w: 24, h: 16, colour: [210, 180, 150, 255] as const },
    { name: 'legwear', x: 16, y: 30, w: 32, h: 20, colour: [30, 80, 160, 255] as const },
  ];
  for (const r of rows) {
    const art = solid(r.w, r.h, r.colour);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) source.data.set(r.colour, ((r.y + y) * 64 + r.x + x) * 4);
    writePng(join(dir, `${r.name}.png`), art);
    writePng(join(dir, `${r.name}_depth.png`), solid(r.w, r.h, [80, 80, 80, 255]));
  }
  writePng(join(dir, 'source.png'), source);
  writePng(join(dir, 'under.png'), solid(16, 10, [80, 90, 100, 255]));
  writeFileSync(join(dir, 'layers.json'), JSON.stringify({ width: 64, height: 64, layers: rows.map(r => ({ name: r.name, filename: `${r.name}.png`, depth_filename: `${r.name}_depth.png`, left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, depth_median: 0.5 })) }));
  return {
    key: 'authored-unit-blocks', seethrough: { resolution: 64, steps: 1, seed: 0, offload: false, head_box: [0, 0, 64, 64] },
    assemble: { rig_scale: 1, plan: [['face', 'full', 'face'], ['token', 'full', 'legwear']], cuts: [{ from: 'token', into: 'piece', polygon: [[16, 30], [32, 30], [32, 40], [16, 40]], draw: 'front', overlap: 0, under: 'under.png' }] },
    bones: [{ name: 'head', parent: 'root', at: [32, 20] }, { name: 'chest', parent: 'root', at: [32, 44] }, { name: 'token_bone', parent: 'head', at: [32, 40] }, { name: 'still_bone', parent: 'head', at: [32, 34] }],
    meshes: {}, regions: { face: 'head', token: 'token_bone', piece: 'token_bone' }, motion: { duration: 1, tracks: [] },
    turn: { pivot: 20, roles: { face: 'surface', token: 'unit' }, unitDepths: { token: 7 } }, depth: { zScale: 24 },
  };
}
