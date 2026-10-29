/** Snapshot public default assembly bytes before/after #848, without updating expectations. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemble, stageFields } from '../src/assemble.ts';
import { loadConfig } from '../src/config.ts';
import { readLayers } from '../src/layers.ts';
import { serializeParts } from '../src/parts.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { checkExampleInputs, pinnedExamplesCommit } from '../scripts/example_inputs.ts';

const [inputRoot = 'examples', output, baseline] = process.argv.slice(2);
if (output === undefined) throw new Error('Expected input examples directory and output JSON, optionally a baseline JSON or --dry-run');
const pin = pinnedExamplesCommit(readFileSync('scripts/fetch-examples.sh', 'utf8'));
const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const records: Record<string, Record<string, string>> = {};
for (const key of ['demo', 'reference-demo', 'reference-sample', 'scarf', 'wind']) {
  const dir = join(inputRoot, key, 'inputs');
  const problems = checkExampleInputs(dir, key, pin);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const input = { source: readPng(join(dir, 'painting.png')), full: readLayers(join(dir, 'layers/full')),
    head: readLayers(join(dir, 'layers/head')), ...stageFields(loadConfig(join('examples', key, 'config.json'))) };
  if (baseline === '--dry-run') { console.log('READERS PASS ' + key + ': pinned files, painting, layer PNGs, full config and stage fields'); continue; }
  const r = assemble({ ...input, seamRule: 'near-white', projectRule: 'core' });
  const files: Record<string, string> = { 'parts.json': digest(serializeParts(r.parts)),
    'recomposite_rig.png': digest(encodePngBytes(r.recomposite)),
    'recomposite_error_rig.png': digest(encodePngBytes(r.errorMap)) };
  for (const p of r.images) {
    files['parts/' + p.record.name + '.png'] = digest(encodePngBytes(p.image));
    if (p.depthImage !== undefined) files['parts/' + p.record.depth!.image] = digest(encodePngBytes(p.depthImage));
  }
  records[key] = files;
  console.log('SNAPSHOT ' + key + ': ' + Object.keys(files).length + ' files');
}
if (baseline !== '--dry-run') {
  writeFileSync(output, JSON.stringify(records, null, 2) + '\n');
  if (baseline !== undefined) {
    const expected: unknown = JSON.parse(readFileSync(baseline, 'utf8'));
    if (JSON.stringify(records) !== JSON.stringify(expected)) throw new Error('DEFAULT_BYTES_CHANGED: public example output hashes differ from the frozen pre-change assembly');
    console.log('PASS: five public examples byte-identical to pre-change assembly');
  }
}
