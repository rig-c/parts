import { withoutCheckRows } from '../src/checkrow.ts';
/** Hand-counted support controls and isolated source mutants (#998). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { supportReport, supportLines, type SupportDomain } from '../src/coincide.ts';
import { newRaster, type Mask } from '../src/raster/types.ts';
import { writeCheckRig } from '../fixtures/checkrig.ts';
import { writePng } from '../src/raster/png.ts';
import { readCheckInputs, type RigcRunner } from '../src/check.ts';
import { readBuildReceipt } from './build-process.ts';
import { observeSupport, supportFigure } from '../src/coincideio.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
export function runCoincideChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const mask = (on: (x: number, y: number) => boolean): Mask => ({ width: 6, height: 4,
    data: Uint8Array.from({ length: 24 }, (_, p) => Number(on(p % 6, Math.floor(p / 6)))) });
  const whole = mask(() => true), left = mask(x => x < 3), right = mask(x => x >= 3);
  const domain = (m: Mask): SupportDomain => ({ part: 'back', mask: m, provenance: { kind: 'cut-polygon', entry: 'assemble.cuts[0]' } });
  const parts = (back: Mask) => [{ name: 'back', mask: back }, { name: 'front', mask: right }];
  const normal = supportReport(6, 4, parts(whole), [domain(whole)], whole);
  const defect = supportReport(6, 4, parts(left), [domain(whole)], whole);
  const side = supportReport(6, 4, parts(left), [domain(left)], whole);
  const unavailable = supportReport(6, 4, parts(left), [], whole);
  const unowned = supportReport(6, 4, [{ name: 'leg', mask: left }], [], whole);
  const checks = [
    ['CK997_SUPPORT_NORMAL', normal.pairs[0].boundary_length_px === 0 && normal.unowned.area_px === 0],
    ['CK998_SUPPORT_DEFECT', defect.pairs[0].boundary_length_px === 4 && JSON.stringify(defect.pairs[0].box) === '[3,0,0,4]' && defect.pairs[0].continuation_candidate_area_px === 12 && defect.pairs[0].front === 'front' && defect.pairs[0].back === 'back'],
    ['CK999_SUPPORT_SIDE_TOUCH', side.pairs[0].boundary_length_px === 0 && side.pairs[0].continuation_candidate_area_px === 0],
    ['CK1000_SUPPORT_UNAVAILABLE', unavailable.pairs[0].status === 'unavailable' && unavailable.pairs[0].boundary_length_px === null && unavailable.coverage.measured === 0 && unavailable.coverage.total === 1 && supportLines(unavailable)[0].includes('0 of 1 pairs measured')],
    ['CK1001_SUPPORT_UNOWNED_OPEN_EDGE', unowned.unowned.status === 'measured' && unowned.unowned.area_px === 12 && JSON.stringify(withoutCheckRows(unowned.unowned.regions)) === '[{"box":[3,0,3,4],"area_px":12}]' && unowned.pairs.length === 0],
  ] as const;
  for (const [name, ok] of checks) say(name, ok, JSON.stringify({ normal, defect, side, unavailable, unowned }));

  const rawNormal = supportReport(6, 4, parts(whole), [], null);
  const rawDefect = supportReport(6, 4, parts(left), [], null);
  const rawSide = supportReport(6, 4, parts(left), [], null);
  const disjoint = supportReport(6, 4, parts(mask(x => x < 2)), [], null);
  say('CK1018_SUPPORT_RAW_NORMAL_OVERLAP', rawNormal.raw_pairs[0].overlap_area_px === 12 && rawNormal.status === 'UNCLASSIFIED', JSON.stringify(rawNormal.raw_pairs));
  say('CK1019_SUPPORT_RAW_OWNERSHIP_UNKNOWN', JSON.stringify(rawDefect) === JSON.stringify(rawSide) && rawDefect.raw_pairs[0].boundary_length_px === 4 && rawDefect.raw_pairs[0].overlap_area_px === 0 && rawDefect.raw_pairs[0].classification === 'ownership unknown, unclassified' && supportLines(rawDefect)[0].includes('1 pairs adjacent, 0 classified (no extent witness)'), JSON.stringify(rawDefect.raw_pairs));
  say('CK1020_SUPPORT_RAW_DISJOINT_ABSENT', disjoint.raw_pairs.length === 0, JSON.stringify(disjoint.raw_pairs));

  const opaque = newRaster(24, 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) opaque.data.set(x >= 6 && x < 18 && y >= 6 && y < 18 ? [200, 30, 20, 255] : [255, 255, 255, 255], (y * 24 + x) * 4);
  const opaqueFigure = supportFigure(opaque, 24, 24);
  say('CK1024_SUPPORT_FIGURE_REUSE', opaqueFigure.data.some(p => p !== 0) && JSON.stringify(opaqueFigure) === JSON.stringify(supportFigure(opaque, 24, 24, opaque)), 'opaque assembly painting retains nonempty source-derived mask bytes');
  const transparent = { ...opaque, data: opaque.data.slice() };
  for (let p = 3; p < transparent.data.length; p += 4) transparent.data[p] = 0;
  const directTransparent = supportFigure(transparent, 24, 24);
  say('CK1025_SUPPORT_FIGURE_TRANSPARENT_FALLBACK', directTransparent.data.every(p => p === 0) && JSON.stringify(directTransparent) === JSON.stringify(supportFigure(transparent, 24, 24, opaque)), 'transparent source recomputes white ground instead of reusing an opaque colored center');

  const transfer = { width: 2, height: 2, alpha_base64: Buffer.from([0, 1, 1, 0]).toString('base64') };
  const receipt = (figure: unknown): string => JSON.stringify({ version: 1, stage: 'assemble', kind: 'done', supportFigure: figure });
  const transferred = readBuildReceipt('assemble', 0, null, receipt(transfer));
  let badTransfer = false;
  try { readBuildReceipt('assemble', 0, null, receipt({ ...transfer, alpha_base64: Buffer.from([0, 2, 1, 0]).toString('base64') })); }
  catch (error) { badTransfer = error instanceof Error && error.message.startsWith('BUILD_STAGE_SUPPORT_FIGURE:'); }
  say('CK1021_SUPPORT_TRANSIENT_TRANSFER', transferred?.supportFigure?.data.join(',') === '0,1,1,0' && badTransfer, 'private stage receipt preserves binary alpha and refuses a planted nonbinary cell');

  const noSource = supportReport(6, 4, parts(whole), [], null);
  say('CK1007_SUPPORT_SOURCE_ABSENCE', noSource.unowned.status === 'unavailable' && noSource.unowned.area_px === null && noSource.unowned.reason?.includes('--source') === true, JSON.stringify(noSource.unowned));
  const unchanged = JSON.stringify(parts(left));
  supportReport(6, 4, parts(left), [domain(whole)], whole);
  say('CK1008_SUPPORT_INPUTS_UNCHANGED', unchanged === JSON.stringify(parts(left)) && whole.data.every(x => x === 1), 'source masks and independent domain remain byte-identical');
}

/** The source has a continuous painted leg, while its setup art ends at the
 * unowned object's edge. This gap reaches the silhouette's outside edge. */
export function runCoincideSetupChecks(dir: string, say: Say, rigc: RigcRunner): void {
  writeCheckRig(dir);
  const rigPath = join(dir, 'rig.json'), rig = JSON.parse(readFileSync(rigPath, 'utf8')) as { slots: Array<{ name: string }>; skins: { default: Record<string, unknown> } };
  rig.slots = rig.slots.filter((s: { name: string }) => s.name === 'back');
  delete rig.skins.default.front;
  writeFileSync(rigPath, JSON.stringify(rig));
  const partsPath = join(dir, 'parts.json'), manifest = JSON.parse(readFileSync(partsPath, 'utf8')) as { parts: Array<{ name: string }> };
  manifest.parts = manifest.parts.filter(p => p.name === 'back');
  writeFileSync(partsPath, JSON.stringify(manifest));
  const painting = newRaster(48, 80), art = newRaster(30, 80);
  for (let p = 0; p < 48 * 80; p++) painting.data.set([255, 255, 255, 255], p * 4);
  for (let y = 8; y < 72; y++) for (let x = 4; x < 34; x++) {
    painting.data.set([180, 60, 40, 255], (y * 48 + x) * 4);
    if (x < 19) art.data.set([180, 60, 40, 255], (y * 30 + x - 4) * 4);
  }
  writePng(join(dir, 'source.png'), painting);
  for (const folder of ['images', 'parts']) writePng(join(dir, folder, 'back.png'), art);
  const built = rigc(['build', '--rig', rigPath, '--motion', join(dir, 'motion.json'), '--out', join(dir, 'build'), '--profile', 'spine']);
  if (built.status !== 0) { say('CK1009_SUPPORT_ACTUAL_SETUP_OPEN_EDGE', false, built.out); return; }
  const input = readCheckInputs(dir, dir, join(dir, 'source.png'));
  const reading = observeSupport(join(dir, 'build'), input);
  say('CK1009_SUPPORT_ACTUAL_SETUP_OPEN_EDGE', reading.unowned.area_px === 960 &&
    JSON.stringify(withoutCheckRows(reading.unowned.regions)) === '[{"box":[19,8,15,64],"area_px":960}]', JSON.stringify(reading));
  const native = supportFigure(input.source!.painting, input.stage.width, input.stage.height);
  const reused = observeSupport(join(dir, 'build'), input, undefined, native);
  say('CK1022_SUPPORT_TRANSIENT_EQUALS_SOURCE', JSON.stringify(reused) === JSON.stringify(reading), 'transient assembly observation and fresh source path report identical bytes');
  // A declared scene mask that omits the object must not hide the observation.
  const sceneInput = { ...input, parts: input.parts === null ? null : { ...input.parts, scene: { figure_alpha_above: 127, figure_px: 960, figure_mask: 'omitted-object.png' } } };
  const reread = observeSupport(join(dir, 'build'), sceneInput);
  say('CK1010_SUPPORT_SCENE_OMISSION_CANNOT_HIDE_UNOWNED', JSON.stringify(reading) === JSON.stringify(reread), JSON.stringify(reread.unowned));
}

export function runCoincideMutants(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  // Mutants are written to isolated scratch modules. The measured source stays
  // untouched. Each is actually imported and executed by a separate Bun process.
  const sourcePath = resolve(import.meta.dir, '../src/coincide.ts');
  const original = readFileSync(sourcePath, 'utf8');
  const imports = (s: string): string => s.replace(/from '(\.\/[^']+)'/g,
    (_match, relative: string) => `from '${pathToFileURL(resolve(import.meta.dir, '../src', relative)).href}'`);
  const mutants = [
    ['TY818_SUPPORT_NORMAL_MUTANT', 'B.mask.data[b] !== 0 || ', '', 'whole', 'whole', 'r.pairs[0].boundary_length_px === 0'],
    ['TY819_SUPPORT_DEFECT_MUTANT', 'length++;', 'length += 0;', 'left', 'whole', 'r.pairs[0].boundary_length_px === 4'],
    ['TY820_SUPPORT_SIDE_TOUCH_MUTANT', ' || domain.mask.data[a] === 0 || domain.mask.data[b] === 0', '', 'left', 'left', 'r.pairs[0].boundary_length_px === 0'],
    ['TY821_SUPPORT_UNAVAILABLE_MUTANT', 'domains.find(d => d.part === B.name)', 'domains.find(d => d.part === B.name) ?? { mask: B.mask }', 'left', 'none', 'r.pairs[0].status === "unavailable" && r.pairs[0].boundary_length_px === null'],
    ['TY822_SUPPORT_UNOWNED_MUTANT', 'missing[p] = 0;', 'missing[p] = missing[p];', 'left', 'unowned', 'r.unowned.area_px === 12'],
  ];
  for (const [name, before, after, back, support, predicate] of mutants) {
    const path = join(dir, name + '.ts');
    const changed = original.replace(before, after);
    writeFileSync(path, imports(changed));
    const script = `import { supportReport } from ${JSON.stringify(pathToFileURL(path).href)};
      const m = f => ({width:6,height:4,data:Uint8Array.from({length:24},(_,p)=>+f(p%6))});
      const whole=m(()=>true), left=m(x=>x<3), right=m(x=>x>=3);
      const parts=${support === 'unowned' ? '[{name:"leg",mask:left}]' : `[{name:"back",mask:${back}},{name:"front",mask:right}]`};
      const domains=${support === 'none' || support === 'unowned' ? '[]' : `[{part:"back",mask:${support},provenance:{kind:"cut-polygon",entry:"assemble.cuts[0]"}}]`};
      const r=supportReport(6,4,parts,domains,whole); console.log(JSON.stringify({survives:${predicate},r}));`;
    const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    const output: { survives?: boolean } = run.status === 0 ? JSON.parse(run.stdout) : {};
    say(name, changed !== original && run.status === 0 && output.survives === false,
      `isolated mutant exit ${run.status}; ${run.stdout.trim()} ${run.stderr.trim()}`);
  }
}
