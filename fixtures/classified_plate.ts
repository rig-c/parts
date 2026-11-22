/** Flat, scale-1 dual-run scene for #1267. Every rectangle is on the painting grid. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assembleConfig, C, NAVY, paint, type Rect, writeAssembleFixture, Z } from './assemble_fixture.ts';

export const SIDE = 64;
export const BODY: Rect = { x0: 24, y0: 22, x1: 40, y1: 54, colour: C };
export const NEAR_PROP: Rect = { x0: 12, y0: 37, x1: 19, y1: 43, colour: NAVY };
export const FAR_PROP: Rect = { x0: 54, y0: 39, x1: 62, y1: 44, colour: NAVY };
export const ACCESSORY: Rect = { x0: 28, y0: 12, x1: 36, y1: 18, colour: Z };

export function indices({ x0, y0, x1, y1 }: Rect): number[] {
  const pixels: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.push(y * SIDE + x);
  return pixels;
}

export function hash(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function component(rect: Rect, role: 'background-prop' | 'figure-accessory') {
  return { id: hash(JSON.stringify(indices(rect))), role, rect };
}

export function writeClassifiedPlateInputs(dir: string, scale: 1 | 0.5 = 1) {
  // At half scale the 64px runs sample even coordinates. Even half-open
  // edges then put each rectangle on whole rig pixels, each covering 2x2 native pixels.
  const near = scale === 1 ? NEAR_PROP : { ...NEAR_PROP, y0: 36, x1: 20, y1: 42 };
  const far = scale === 1 ? FAR_PROP : { ...FAR_PROP, y0: 38, y1: 46 };
  const config = { ...assembleConfig({
    plan: [['body', 'full', 'topwear']], extend: [], rigScale: scale, resolution: SIDE, headBox: [0, 0, SIDE, SIDE],
  }), scene: {} };
  writeAssembleFixture(dir, config, paint(SIDE, SIDE, [180, 195, 210], [BODY, near, far, ACCESSORY]), {
    full: [
      { name: 'topwear', depth: 0.3, rects: [BODY] },
      { name: 'objects', depth: 0.4, rects: [near, far] },
      { name: 'headwear', depth: 0.5, rects: [ACCESSORY] },
    ],
    head: [{ name: 'face', depth: 0.5, rects: [BODY] }],
  });
  const assemble = join(dir, 'assemble');
  const rig = join(assemble, 'rig');
  return {
    assemble, rig, painting: join(dir, 'painting.png'), full: join(dir, 'full'), head: join(dir, 'head'),
    config: join(dir, 'config.json'), figure: join(rig, 'figure_rig.png'), parts: join(rig, 'parts.json'),
    body: join(rig, 'parts', 'body.png'),
    components: [component(ACCESSORY, 'figure-accessory'), component(near, 'background-prop'), component(far, 'background-prop')],
  };
}

export function writeClassifiedPlateManifest(dir: string, source: ReturnType<typeof writeClassifiedPlateInputs>, labelled: boolean): string {
  const path = join(dir, labelled ? 'classified.json' : 'unlabelled.json');
  writeFileSync(path, `${JSON.stringify({
    spec: 'rig-parts-plate-components/1',
    parts_dir: relative(dir, source.rig),
    painting_sha256: hash(readFileSync(source.painting)),
    figure_mask_sha256: hash(readFileSync(source.figure)),
    parts_manifest_sha256: hash(readFileSync(source.parts)),
    components: labelled ? source.components.map(({ id, role }) => ({ id, role })) : [],
  }, null, 2)}\n`);
  return path;
}
