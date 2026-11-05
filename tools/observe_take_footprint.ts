/** First-writer observation on a private copy; installed sources stay intact. */
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { assembleStage } from '../src/build.ts';
import type { PartRecord } from '../src/parts.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

export type FootprintTrace = Map<string, Raster>;
type Row = { key?: string; name?: string; image: Raster; record?: PartRecord };
type ObserverGlobal = { rigPartsTakeFootprint?: (stage: string, rows: unknown, frame: unknown) => void };

/** Capture the real warp, projection and subsequent writers, including seam. */
export function takeFootprintObserver(dir: string): (input: Parameters<typeof assembleStage>[0], output: Parameters<typeof assembleStage>[1], target: string, source: string) => { result: ReturnType<typeof assembleStage>; trace: FootprintTrace } {
  const home = resolve(dir, 'observer');
  mkdirSync(home, { recursive: true });
  const original = resolve(import.meta.dir, '../src'), copy = join(home, 'src');
  cpSync(original, copy, { recursive: true });
  symlinkSync(resolve(import.meta.dir, '../node_modules'), join(home, 'node_modules'), 'dir');
  const files = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(folder, entry.name)) : [join(folder, entry.name)]);
  const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
  for (const file of files(copy)) {
    if (statSync(file).nlink !== 1 || sha(file) !== sha(join(original, relative(copy, file)))) throw new Error('footprint observer requires an identical, singly linked source copy');
  }
  const path = join(copy, 'assemble.ts');
  let text = readFileSync(path, 'utf8');
  const hook = (stage: string, rows: string): string => `\n(globalThis as unknown as { rigPartsTakeFootprint?: (stage: string, rows: unknown, frame: unknown) => void }).rigPartsTakeFootprint?.('${stage}', ${rows}, frame);\n`;
  const replace = (anchor: string, insertion: string): void => {
    if (text.split(anchor).length !== 2) throw new Error(`footprint observer requires one source anchor: ${anchor.trim()}`);
    text = text.replace(anchor, insertion + anchor);
  };
  const layers = "layers.map((layer, i) => ({ key: run + ':' + layer.tag, image: rigLayers[i] }))";
  const stack = 'stack.map(part => ({ name: part.record.name, image: part.image }))';
  const placed = 'placed.map(part => ({ name: part.record.name, image: part.image, record: part.record }))';
  replace('    const rank = planRanks(', hook('warp', layers));
  replace('    writes.forEach((ids, i)', hook('projection', layers));
  replace('  // Issue #255:', hook('alpha', stack));
  replace("  // Issue #953: under `visible`,", hook('prePaintingEdges', stack));
  replace('  const pushedOf: FringePushed[][]', hook('postPaintingEdges', stack));
  replace('  seamOverride(placed,', hook('preSeam', placed));
  replace('  placed.forEach((p, i) => {', hook('postSeam', placed));
  writeFileSync(path, text);
  const copied = createRequire(import.meta.url)(join(copy, 'build.ts')) as { assembleStage: typeof assembleStage };
  return (input, output, target, source) => {
    const trace: FootprintTrace = new Map();
    const observer = globalThis as ObserverGlobal;
    const previous = observer.rigPartsTakeFootprint;
    observer.rigPartsTakeFootprint = (stage, rows, frame) => {
      const row = (rows as readonly Row[]).find(part => part.name === target || part.key === source);
      if (row === undefined) return;
      const grid = frame as { W: number; H: number };
      let image = row.image;
      if (row.record !== undefined) {
        const canvas = newRaster(grid.W, grid.H);
        for (let y = 0; y < image.height; y++) canvas.data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((row.record.y + y) * grid.W + row.record.x) * 4);
        image = canvas;
      }
      trace.set(stage, { ...image, data: image.data.slice() });
    };
    try {
      const result = copied.assembleStage(input, output, () => {});
      observer.rigPartsTakeFootprint?.('emit', result.images.map(part => ({ name: part.record.name, image: part.image, record: part.record })), { W: result.parts.rig_size[0], H: result.parts.rig_size[1] });
      return { result, trace };
    } finally {
      observer.rigPartsTakeFootprint = previous;
    }
  };
}

/** The first differing stage is tracked independently for each RGBA channel. */
export function firstTakeWriters(before: FootprintTrace, after: FootprintTrace): Uint8Array {
  const emitted = after.get('emit');
  if (emitted === undefined) throw new Error('footprint observer requires emitted pixels');
  const writers = new Uint8Array(emitted.data.length);
  for (const [stage, image] of after) {
    const original = before.get(stage);
    if (original === undefined || original.data.length !== writers.length) throw new Error(`footprint observer lacks matching stage ${stage}`);
    for (let channel = 0; channel < writers.length; channel++) {
      if (writers[channel] === 0 && original.data[channel] !== image.data[channel]) writers[channel] = stage === 'projection' ? 1 : 2;
    }
  }
  return writers;
}
