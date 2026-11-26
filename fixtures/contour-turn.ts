/**
 * Synthetic contour/body-turn regression (issue #1306).
 *
 * The four PROPOSE_PARTS boxes are multiplied by four on an 800x1200 canvas.
 * The fifth part is the pixel-center fill of the polygon below, in its own
 * 400x180 box at [200,400]. Its seven vertices, colors and depth recipe are
 * explicit inputs, not readings from art. The figure extends from y=160 to
 * y=1000, so H=840 and the existing proposer derives spacing round(840/37)=23
 * and tolerance=margin=max(1,round(840/554))=2.
 *
 * origin: Stage A at 3ec9d89649a8e55b374840989eb452f61646792f, Bun 1.4.4,
 * rigc 3.7.0 / spine-core 4.3.13 on Linux. The no-turn and lattice hashes
 * below seal the emitted rig, motion and six PNGs, not visual correctness.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { depthReading } from '../src/depthsheets.ts';
import { applyDepth, bindDepthMap, prepareDepth } from '../src/depthworkflow.ts';
import { readParts, writeParts } from '../src/parts.ts';
import { propose, readPartSet } from '../src/propose.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { PROPOSE_PARTS, type ProposeFixturePart, writeProposeFixture } from './propose.ts';

const OMIT_BUST = 'synthetic closed torso without bust landmarks';
const POLYGON: ReadonlyArray<readonly [number, number]> = [[260, 0], [400, 0], [400, 180], [260, 180], [260, 112], [0, 88], [260, 64]];

export const CONTOUR_TURN_STAGE_A_HASHES = {
  noTurn: {
    rig: 'a918f766dfc83602f4e0b6422fb6b9f2539a3cd508fa5ead136083c5505da300',
    motion: 'fa005df6922daf2b6f1d5e111012be6f72769f57315d146bac52e9eb832f0f61',
  },
  lattice: {
    rig: 'e5ca1bc0d37d77f2c347dde0c3aec3b1d584cfd8bff5666f6d39609ac19582f1',
    motion: 'b18dd0fbfa80f988ca1c60bb202588464206d344d311d25ad7aa070151366704',
  },
  images: '609a4e318985b31421e87f074ee9d500b8dae93968fbfe452872415f3dabb26d',
} as const;

export interface ContourTurnFixture {
  parts: string;
  config: string;
  noTurn: string;
  lattice: string;
}

/** Purely synthetic data, written under the caller's owned temporary directory. */
export function writeContourTurnFixture(dir: string): ContourTurnFixture {
  mkdirSync(dir, { recursive: true });
  const definitions: ProposeFixturePart[] = [
    ...PROPOSE_PARTS.map(part => ({ ...part, x: part.x * 4, y: part.y * 4, w: part.w * 4, h: part.h * 4 })),
    { name: 'bodice', from: 'full:topwear', x: 200, y: 400, w: 400, h: 180, colour: [60, 80, 100] },
  ];
  const assembled = join(dir, 'assembled');
  writeProposeFixture(assembled, definitions, { w: 800, h: 1200 });
  const art = newRaster(400, 180);
  let opaque = 0;
  for (let y = 0; y < 180; y++) for (let x = 0; x < 400; x++) {
    let inside = false;
    for (let i = 0, j = POLYGON.length - 1; i < POLYGON.length; j = i++) {
      const a = POLYGON[i], b = POLYGON[j];
      if ((a[1] > y + 0.5) !== (b[1] > y + 0.5) && x + 0.5 < (b[0] - a[0]) * (y + 0.5 - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    if (inside) { art.data.set([60, 80, 100, 255], (y * 400 + x) * 4); opaque++; }
  }
  writeFileSync(join(assembled, 'parts', 'bodice.png'), encodePngBytes(art));
  const parts = readParts(join(assembled, 'parts.json'));
  const bodice = parts.parts.find(part => part.name === 'bodice');
  if (bodice === undefined) throw new Error('synthetic contour fixture requires its named bodice');
  bodice.opaque_px = opaque;
  writeParts(join(assembled, 'parts.json'), parts);

  const draft = propose(readPartSet(assembled), undefined, undefined, undefined, undefined, true, { noBust: OMIT_BUST });
  const source = join(dir, 'source-config.json');
  writeJson(source, {
    key: 'synthetic-depth-contour',
    assemble: { rig_scale: 1, plan: definitions.map(part => [part.name, ...part.from.split(':')]) },
    bones: draft.bones, meshes: draft.meshes, regions: draft.regions, motion: draft.motion,
    turn: { body: { pivot: 40, roles: { bodice: 'surface' } } },
  });
  const data = Array.from({ length: 400 * 180 }, (_, i) => Math.sin(Math.PI * (i % 400) / 399) * Math.sin(Math.PI * Math.floor(i / 400) / 179));
  const map = join(dir, 'depth-map.json');
  writeJson(map, { spec: 'rig-parts-map/1', width: 400, height: 180, channels: 1, data });
  const recipe = join(dir, 'recipe.json');
  writeJson(recipe, {
    spec: 'rig-parts-depth/1', prepare: { longSide: 400, paddingFraction: 0, padding: 0 },
    groups: { body: { near: 'white', zScale: 1600, pivot: 40 } },
    parts: { bodice: { map: 'depth-map.json', source: 'depth', frame: 'part', group: 'body', median: 800, relief: 464 } }, clear: [],
  });
  const prepared = join(dir, 'prepared');
  prepareDepth({ parts: assembled, config: recipe, out: prepared });
  bindDepthMap({ map, input: join(prepared, 'bodice.png'), part: 'bodice' });
  const applied = join(dir, 'applied');
  applyDepth({ parts: assembled, manifest: join(prepared, 'manifest.json'), config: recipe, rigConfig: source, out: applied });
  const appliedDraft = propose(readPartSet(applied), undefined, undefined, undefined, undefined, true, { noBust: OMIT_BUST });
  const raw = JSON.parse(readFileSync(join(applied, 'config.json'), 'utf8')) as Record<string, unknown>;
  raw.bones = appliedDraft.bones; raw.meshes = appliedDraft.meshes; raw.regions = appliedDraft.regions; raw.motion = appliedDraft.motion;
  const config = join(dir, 'combined-config.json');
  writeJson(config, raw);
  const noTurn = join(dir, 'no-turn.json');
  const without = structuredClone(raw);
  delete without.turn;
  writeJson(noTurn, without);
  const lattice = join(dir, 'lattice.json');
  const withLattice = structuredClone(raw);
  const meshes = withLattice.meshes as Record<string, unknown>;
  const contour = appliedDraft.meshes.bodice;
  if (!('contour' in contour)) throw new Error('synthetic chest fixture requires the actual proposed contour');
  meshes.bodice = { grid: contour.contour.spacing, r: contour.r, segments: contour.segments };
  writeJson(lattice, withLattice);
  return { parts: applied, config, noTurn, lattice };
}

/**
 * A flat square with an authored scalar ramp, blended to a head bone only at
 * its left edge. The contour at x=20 has nominal share 1/4 and eased share
 * 3/16. Both the edge and the next boundary column sample the same depth
 * plateau. The face's median matches that plateau and the body median is its
 * far plane. The resulting body relief at the edge is the authored ramp
 * height plus the head–body model depth separation times the placement scale.
 * The separate tab takes its own model depth through the body unit carrier.
 */
export function writeContourFalloffTurnFixture(dir: string, depthScale: 250 | 400, stronger = false) {
  const modelDepth = { body: 0.04, head: 0.08, tab: 0.12 };
  const bodyDepth = modelDepth.body * depthScale;
  const plateauDepth = modelDepth.head * depthScale + (stronger ? 123 : 63);
  const unitDepth = modelDepth.tab * depthScale;
  const zScale = 250; // The 8-bit depth step is below one rig pixel and resolves the authored relief.
  const spacing = 24;
  const partsDir = join(dir, 'assembled');
  writeProposeFixture(partsDir, [
    { name: 'topwear', from: 'full:topwear', x: 20, y: 26, w: 96, h: 34, colour: [60, 80, 100] },
    { name: 'face', from: 'head:face', x: 24, y: 12, w: 16, h: 14, colour: [200, 180, 160] },
    { name: 'tab', from: 'full:bottomwear', x: 132, y: 52, w: 8, h: 8, colour: [120, 80, 60] },
  ], { w: 152, h: 80 });
  const manifest = join(partsDir, 'parts.json');
  const parts = readParts(manifest);
  for (const p of parts.parts) {
    if (p.name === 'tab') continue;
    const art = readPng(join(partsDir, 'parts', `${p.name}.png`));
    const scalar = newRaster(p.w, p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const ramp = Math.max(0, 1 - Math.max(0, x - 8) / 36);
      const depth = p.name === 'face' ? plateauDepth : bodyDepth + (plateauDepth - bodyDepth) * ramp;
      const value = Math.round(depth * 255 / zScale);
      scalar.data.set([value, value, value, 255], 4 * (y * p.w + x));
    }
    const image = `${p.name}_depth.png`;
    const bytes = encodePngBytes(scalar);
    writeFileSync(join(partsDir, 'parts', image), bytes);
    p.depth = {
      image, near: 'white', zScale,
      sources: [{
        from: p.from, image: 'scalar.png', sha256: createHash('sha256').update(bytes).digest('hex'),
        crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null),
      }],
    };
  }
  writeParts(manifest, parts);
  const config = (mode: 'default' | 'linear' | 'doubled'): string => {
    const path = join(dir, `contour-depth-${depthScale}-${mode}.json`);
    writeJson(path, {
      key: 'synthetic-falloff-turn',
      assemble: { rig_scale: 1, plan: parts.parts.map(p => [p.name, ...p.from.split(':')]) },
      bones: [
        { name: 'chest', parent: 'root', at: [32, 50] },
        { name: 'torso', parent: 'chest', at: [32, 50] },
        { name: 'head', parent: 'chest', at: [32, 26] },
        { name: 'crown', parent: 'head', at: [32, 20] },
        { name: 'tab_bone', parent: 'chest', at: [136, 56] },
      ],
      regions: { face: 'crown', tab: 'tab_bone' },
      meshes: {
        topwear: {
          r: 8, segments: [['torso', [32, 58], [32, 30]]],
          contour: {
            tolerance: 0, margin: 0, spacing, maxEdge: 4,
            regions: [
              {
                name: 'collar', shape: 'polygon', points: [[0, 10], [8, 10], [8, 70], [0, 70]],
                bone: 'crown', cover: 'face', band: mode === 'doubled' ? 32 : 16, spacing,
                ...(mode === 'linear' ? { falloff: 'linear' } : {}),
              },
              { name: 'seam', shape: 'circle', cx: 32, cy: 26, r: 1, bone: 'torso', band: 0, spacing },
            ],
          },
        },
      },
      motion: { duration: 2, tracks: [{ bone: 'chest', prop: 'rotate', amp: 2, period: 2, phase: 0 }] },
      turn: {
        pivot: 0, grid: [5, 5], roles: { face: 'surface' },
        body: { pivot: 0, roles: { topwear: 'surface', tab: 'unit' }, unitDepths: { tab: unitDepth } },
      },
    });
    return path;
  };
  return { parts: partsDir, config };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
