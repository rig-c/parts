/** Sidecar controls use generated parts and mutate only their private copies. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assembleConfig, writeAssembleFixture } from '../fixtures/assemble_fixture.ts';
import { assembleStage } from '../src/build.ts';
import { writeCheckRig } from '../fixtures/checkrig.ts';
import { SUPPORT_GRID_CODE, type SupportDomain } from '../src/coincide.ts';
import { PartsError } from '../src/errors.ts';
import { readParts, writeParts } from '../src/parts.ts';
import { readSupportDomains, writeSupportDomains, SUPPORT_DOMAINS_FILE } from '../src/supportdomains.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
export function runSupportDomainChecks(dir: string, say: Say): void {
  writeCheckRig(dir);
  const partsPath = join(dir, 'parts.json'), partsDir = join(dir, 'parts');
  const parts = readParts(partsPath), [width, height] = parts.rig_size;
  const domain: SupportDomain = { part: 'back', mask: { width, height, data: new Uint8Array(width * height).fill(1) },
    provenance: { kind: 'cut-polygon', entry: 'config.assemble.cuts[0].polygon' } };
  const file = join(dir, SUPPORT_DOMAINS_FILE);
  const hashes = (): string => JSON.stringify([partsPath, ...parts.parts.map(p => join(partsDir, `${p.name}.png`))].map(path => createHash('sha256').update(readFileSync(path)).digest('hex')));
  const before = hashes();
  const emit = (): void => writeSupportDomains(partsPath, partsDir, parts, [domain], 'derived full-canvas control');
  emit();
  const first = readFileSync(file);
  const rows = readSupportDomains(partsPath, partsDir, parts);
  say('CK1011_SUPPORT_DOMAIN_ROUNDTRIP', rows.length === 2 && 'mask' in rows[0] && rows[0].mask.data.every(p => p === 1) &&
    rows[0].provenance.entry === domain.provenance.entry && !('mask' in rows[1]), JSON.stringify(rows.map(d => ({ part: d.part, measured: 'mask' in d }))));
  emit();
  const same = first.equals(readFileSync(file));
  const planted = JSON.parse(first.toString()); planted.timestamp = 1;
  say('CK1012_SUPPORT_DOMAIN_DETERMINISM', same && !first.equals(Buffer.from(JSON.stringify(planted))), `repeat identical ${same}; a planted field changes the bytes`);
  say('CK1013_SUPPORT_DOMAIN_EXISTING_BYTES', hashes() === before, `parts.json and both part PNG hashes ${before}`);

  const imagePath = join(partsDir, 'back.png'), image = readFileSync(imagePath);
  let staleImage = false;
  try {
    writeFileSync(imagePath, Buffer.concat([image, Buffer.from([0])]));
    staleImage = readSupportDomains(partsPath, partsDir, parts).every(d => !('mask' in d));
  } finally { writeFileSync(imagePath, image); }
  const manifest = readFileSync(partsPath);
  let staleParts = false;
  try {
    writeFileSync(partsPath, Buffer.concat([manifest, Buffer.from('\n')]));
    staleParts = readSupportDomains(partsPath, partsDir, parts).every(d => !('mask' in d));
  } finally { writeFileSync(partsPath, manifest); }
  say('CK1014_SUPPORT_DOMAIN_STALE_BINDINGS', staleImage && staleParts && hashes() === before, `changed PNG refused as unavailable ${staleImage}; changed manifest ${staleParts}; restored hashes ${hashes() === before}`);

  let named = false;
  try {
    const wrong = JSON.parse(first.toString()); wrong.grid[0]++;
    writeFileSync(file, JSON.stringify(wrong));
    try { readSupportDomains(partsPath, partsDir, parts); }
    catch (error) { named = error instanceof PartsError && error.problems.some(p => p.code === SUPPORT_GRID_CODE); }
  } finally { writeFileSync(file, first); }
  say('CK1015_SUPPORT_DOMAIN_GRID_REFUSAL', named && hashes() === before, `wrong native grid refused by ${SUPPORT_GRID_CODE}; source bytes restored ${hashes() === before}`);

  parts.parts[0].limb = { name: 'leg', segment: 0, of: 'back', bone: 'root' };
  writeParts(partsPath, parts);
  writeSupportDomains(partsPath, partsDir, parts, [], 'no authored radial width');
  const limb = readSupportDomains(partsPath, partsDir, parts)[0];
  say('CK1016_SUPPORT_DOMAIN_LIMB_UNAVAILABLE', !('mask' in limb) && limb.reason === 'limb segment "back" has joint lines but no authored radial width; the art-derived cap radius is not an independent witness', JSON.stringify(limb));
  const assembly = join(dir, 'assembly');
  const config = assembleConfig();
  (config.assemble as Record<string, unknown>).cuts = [{ from: 'topwear', into: 'tie', polygon: [[0, 0], [32, 0], [0, 64]], draw: { before: 'bottomwear' }, overlap: 0 }];
  (config.regions as Record<string, unknown>).tie = 'anchor';
  writeAssembleFixture(assembly, config);
  const out = join(assembly, 'out');
  try {
    const result = assembleStage({ source: join(assembly, 'painting.png'), full: join(assembly, 'full'), head: join(assembly, 'head'), config: join(assembly, 'config.json') },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'error.png') }, () => undefined);
    const produced = readSupportDomains(join(out, 'parts.json'), join(out, 'parts'), result.parts).find(d => d.part === 'tie');
    const part = result.parts.parts.find(p => p.name === 'tie');
    const independent = produced !== undefined && 'mask' in produced && produced.mask.data.every((value, p) =>
      value === Number(2 * (p % 64 + 0.5) + Math.floor(p / 64) + 0.5 < 64));
    say('CK1017_SUPPORT_ASSEMBLER_DOMAIN_PRECEDES_ALPHA', independent && part !== undefined && part.x > 0 && produced !== undefined && 'mask' in produced && produced.mask.data[0] === 1,
      `whole triangle matches 2*x+y<64 ${independent}; emitted part starts at ${part?.x},${part?.y}, independent domain includes unpainted 0,0`);
  } catch (error) {
    say('CK1017_SUPPORT_ASSEMBLER_DOMAIN_PRECEDES_ALPHA', false, error instanceof Error ? error.message : String(error));
  }

}
