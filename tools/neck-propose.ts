/** Filesystem adapter for the explicit --write-config sampled-turn context. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig, parseConfig } from '../src/config.ts';
import { draftIndependentNeck } from '../src/neckdraft.ts';
import { readRigInputs, readUnders, readCaps } from '../src/build.ts';
import { readLayers } from '../src/layers.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { writeParts } from '../src/parts.ts';
import { configWriteLines, separateConfigWriteTarget, stageConfigWrite, type ConfigWriteTarget } from './configwrite.ts';
import { PartsError } from '../src/errors.ts';

export function proposeNeck(target: ConfigWriteTarget, args: { source: string; full?: string; head?: string; parts: string; out: string }): void {
  if (args.full === undefined || args.head === undefined) throw new PartsError([{ code: 'PROPOSE_NECK_RUNS', object: 'propose --write-config', detail: 'a sampled body turn with a neck requires --full and --head to inspect and reassemble its source; give both runs' }]);
  const output = join(args.out, 'rig');
  if (existsSync(output) || resolve(output) === resolve(args.parts)) throw new PartsError([{ code: 'PROPOSE_NECK_OUT_FRESH', object: output, detail: 'already exists or is the input parts directory; choose a fresh --out so source parts and previous draft evidence remain intact' }]);
  const config = loadConfig(target.path);
  const previous = readRigInputs(target.path, args.parts);
  const draft = draftIndependentNeck({ config, source: readPng(args.source), full: readLayers(args.full), head: readLayers(args.head), base: dirname(target.path), under: readUnders(target.path, config.assemble.cuts ?? []), caps: config.limbs === undefined ? undefined : readCaps(target.path, config.limbs), previous });
  parseConfig(draft.config);
  separateConfigWriteTarget(target, [join(args.out, 'proposal.json'), join(output, 'parts.json'), ...draft.assembled.images.flatMap(p => [join(output, 'parts', `${p.record.name}.png`), ...(p.record.depth === undefined ? [] : [join(output, 'parts', p.record.depth.image)])])]);
  const staged = stageConfigWrite(target, { kind: 'neck-unit', config: draft.config });
  try {
    const out = join(args.out, 'rig');
    mkdirSync(join(out, 'parts'), { recursive: true });
    writeParts(join(out, 'parts.json'), draft.assembled.parts);
    for (const p of draft.assembled.images) {
      writePng(join(out, 'parts', `${p.record.name}.png`), p.image);
      if (p.depthImage !== undefined && p.record.depth !== undefined) writePng(join(out, 'parts', p.record.depth.image), p.depthImage);
    }
    const { bones, meshes, regions, motion, constraints, turn, proposed_rig_scale } = draft.config;
    writeFileSync(join(args.out, 'proposal.json'), JSON.stringify({ bones, meshes, regions, motion, ...(constraints === undefined ? {} : { constraints }), turn, ...(proposed_rig_scale === undefined ? {} : { proposed_rig_scale }), notes: draft.notes }, null, 2) + '\n');
    staged.commit();
    for (const line of configWriteLines(target, staged.changes)) console.error(line);
    for (const note of draft.notes) console.log(`note: ${note}`);
    console.log(`wrote proposal.json and reassembled full-run neck pixels under ${out}; config body turn and other authored sections retained; run rig/build through the gate`);
  } catch (error) { staged.abort(error); }
  finally { staged.cancel(); }
}
