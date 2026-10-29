/** Read-only origin snapshot comparison of every fetched public example's producer bytes. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [originArg, inputArg, scratchArg, receiptArg] = process.argv.slice(2);
if ([originArg, inputArg, scratchArg, receiptArg].some(p => p === undefined)) throw new Error('origin root, public input root, scratch and receipt paths required');
const roots = [resolve(originArg), process.cwd()], scratch = resolve(scratchArg), keys = readdirSync(join(roots[0], 'examples')).filter(k => { try { return JSON.parse(readFileSync(join(roots[0], 'examples', k, 'config.json'), 'utf8')).key !== undefined; } catch { return false; } }).sort();
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const rows: unknown[] = [];
for (const key of keys) {
  const tables: Map<string, string>[] = [], notes: string[][] = [];
  for (let side = 0; side < roots.length; side++) {
    const root = roots[side], config = join(roots[0], 'examples', key, 'config.json'), inputs = join(resolve(inputArg), key, 'inputs'), out = join(scratch, String(side), key);
    const b = await import(join(root, 'src/build.ts')), p = await import(join(root, 'src/propose.ts')), l = await import(join(root, 'src/layers.ts')), a = await import(join(root, 'src/assemble.ts')), rig = await import(join(root, 'src/rig.ts')), png = await import(join(root, 'src/raster/png.ts')), cfg = await import(join(root, 'src/config.ts'));
    b.assembleStage({ source: join(inputs, 'painting.png'), full: join(inputs, 'layers/full'), head: join(inputs, 'layers/head'), config, seam: 'near-white', project: 'core' }, { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite.png'), errorMap: join(out, 'error.png') }, () => {});
    const loaded = b.readRigInputs(config, out), built = rig.buildRig(loaded.cfg, loaded.parts, loaded.images), P = p.readPartSet(out), proposal = p.proposeWithBasis(P).proposal;
    const table = new Map<string, string>();
    for (const file of readdirSync(join(out, 'parts')).sort()) table.set(`parts/${file}`, hash(readFileSync(join(out, 'parts', file))));
    for (const file of ['parts.json', 'recomposite.png', 'error.png']) table.set(file, hash(readFileSync(join(out, file))));
    for (const [name, text] of b.rigOutputTexts(built, loaded.from === null ? null : loaded.from.table)) table.set(`rig/${name}`, hash(text));
    for (const [name, image] of built.images) table.set(`rig/images/${name}`, hash(png.encodePngBytes(image)));
    table.set('proposal.json', hash(p.serializeProposal(proposal)));
    const full = l.readLayers(join(inputs, 'layers/full')), head = l.readLayers(join(inputs, 'layers/head'));
    table.set('proposal-turn.json', hash(p.serializeProposal(p.withTurn(proposal, p.draftTurn(P, { full, head }, proposal)))));
    const geometry = { sourceW: png.readPng(join(inputs, 'painting.png')).width, sourceH: png.readPng(join(inputs, 'painting.png')).height, ...a.proposeFields(cfg.loadEarlyConfig(config, 'layers')) };
    const plan = a.proposePlan(full, head, geometry); table.set('assemble-plan.json', hash(JSON.stringify(plan)));
    notes.push(plan.notes.filter((n: string) => n.includes('PLAN_HEAD_GARMENT_OVERLAP')));
    tables.push(table);
  }
  const changes = [...new Set([...tables[0].keys(), ...tables[1].keys()])].sort().filter(k => tables[0].get(k) !== tables[1].get(k));
  const unexpected = changes.filter(k => k !== 'assemble-plan.json');
  rows.push({ key, compared: tables[0].size, changed: changes, warnings: notes[1], unexpected, originHashes: Object.fromEntries(tables[0]), candidateHashes: Object.fromEntries(tables[1]) });
  console.log(`${unexpected.length === 0 ? 'PASS' : 'FAIL'} ORIGIN_BYTES ${key}: ${tables[0].size} assets/JSON, changes=${JSON.stringify(changes)}`);
  if (unexpected.length > 0) process.exitCode = 1;
}
mkdirSync(resolve(receiptArg, '..'), { recursive: true });
writeFileSync(receiptArg, JSON.stringify({ origin: process.env.NECK_ORIGIN_SHA ?? null, examples: rows }, null, 2) + '\n');
