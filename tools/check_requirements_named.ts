/** Issue #1418 / #1419: a --requirements file whose content reaches assembly must be the one config.requirements names, in both --out and --emit-fill-masks modes. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assembleConfig } from '../fixtures/assemble_fixture.ts';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { writeTakeFixture } from '../fixtures/take_layers.ts';
import type { AssembleResult } from '../src/assemble.ts';
import { assembleStage } from '../src/build.ts';
import { PartsError } from '../src/errors.ts';
import { REGION_TOLERANCE_FIELD } from '../src/assembly-reading.ts';
import { exportLayers } from '../src/layers.ts';
import { readParts } from '../src/parts.ts';
import { newRaster } from '../src/raster/types.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { readLayerTag } from '../src/tags.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Every file under `dir`, relative, with its sha256, in sorted order. */
function tree(dir: string): string {
  if (!existsSync(dir)) return '(absent)';
  return JSON.stringify(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name)).sort().map(file => [relative(dir, file), sha(readFileSync(file))]));
}

export function runRequirementsNamedChecks(dir: string, say: Say): void {
  const home = join(dir, 'named');
  const cfg = writeTakeRegionFixture(home);
  const assembleOf = cfg.assemble as Record<string, unknown>;
  const undeclared = { ...cfg };
  delete undeclared.requirements;
  const requirements = JSON.parse(readFileSync(join(home, 'requirements.json'), 'utf8')) as Record<string, unknown> & { setup_painting: Record<string, unknown> };
  const writeJson = (name: string, value: unknown): string => { const path = join(home, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value)); return path; };
  // Tolerance 7 keeps the fixture's region (its donor protrusion is far outside 7) and is not the fixture's 0.
  const tolerated = writeJson('requirements.json', { ...requirements, setup_painting: { ...requirements.setup_painting, rgb_tolerance: 7 } });
  const run = (name: string, config: unknown, flag: string | undefined): { ok: boolean; code: string; text: string; notes: string[]; out: string } => {
    const configPath = writeJson(`${name}.json`, config);
    const out = join(home, 'out-' + name);
    const notes: string[] = [];
    try {
      assembleStage({ source: join(home, 'painting.png'), full: join(home, 'full'), head: null, config: configPath, ...(flag === undefined ? {} : { requirements: flag }) },
        { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite.png'), errorMap: join(out, 'error.png') }, line => notes.push(line));
      return { ok: true, code: '', text: '', notes, out };
    } catch (error) {
      if (!(error instanceof PartsError)) throw error;
      return { ok: false, code: error.problems.map(problem => problem.code).join(','), text: error.message, notes, out };
    }
  };
  const toleranceRow = (out: string): string | undefined => (JSON.parse(readFileSync(join(out, 'parts.json'), 'utf8')) as { assembly_config: { fields: Array<{ name: string; sha256: string }> } })
    .assembly_config.fields.find(row => row.name === REGION_TOLERANCE_FIELD)?.sha256;
  const setupRow = (out: string): boolean => (JSON.parse(readFileSync(join(out, 'parts.json'), 'utf8')) as { assembly_config: { fields: Array<{ name: string }> } })
    .assembly_config.fields.some(row => row.name === 'requirements.setup_painting');
  const tookAt = (notes: string[], tolerance: number): boolean => notes.some(line => line.includes(`RGB tolerance ${tolerance};`));

  // Region take, flag only: refused by name, nothing written.
  const flagOnly = run('flag-only', undeclared, tolerated);
  const flagDigest = sha(readFileSync(tolerated)).slice(0, 16);
  say('URQ01_FLAG_ONLY_REQUIREMENTS_UNDER_A_REGION_TAKE_IS_REFUSED',
    !flagOnly.ok && flagOnly.code === 'ASSEMBLE_REQUIREMENTS_UNDECLARED' &&
      flagOnly.text === `ASSEMBLE_REQUIREMENTS_UNDECLARED: --requirements ${tolerated} — ${tolerated} (sha256 ${flagDigest}) gives assembly setup_painting.rgb_tolerance (a region take), and config.requirements is absent; assembly_config reads only config.requirements, so a file that reaches assembly must be named there — add "requirements": "requirements.json" to ${join(home, 'flag-only.json')}` &&
      !existsSync(flagOnly.out),
    flagOnly.text || 'accepted');

  // One file, two writings: the flag relative to the working directory, the declaration relative to the config.
  const sameFile = run('same-file', cfg, relative(process.cwd(), tolerated));
  say('URQ02_ONE_FILE_BY_TWO_WRITTEN_PATHS_IS_ACCEPTED_AND_THE_STAMP_HOLDS_THE_TOLERANCE_USED',
    sameFile.ok && tookAt(sameFile.notes, 7) && toleranceRow(sameFile.out) === sha('7'),
    sameFile.ok ? `flag ${relative(process.cwd(), tolerated)}; config "requirements.json"; region take tolerance 7: ${tookAt(sameFile.notes, 7)}; stamp row ${toleranceRow(sameFile.out)?.slice(0, 12)} = sha256("7") ${sha('7').slice(0, 12)}` : sameFile.text);

  // Two copies of one file: the same bytes are the same file, as BUILD_REQUIREMENTS_CONFLICT already holds.
  const copy = join(home, 'copies', 'requirements.json');
  mkdirSync(join(home, 'copies'), { recursive: true });
  cpSync(tolerated, copy);
  const sameBytes = run('same-bytes', cfg, copy);
  say('URQ03_A_COPY_OF_THE_SAME_BYTES_IS_THE_SAME_FILE_AND_THE_STAMP_HOLDS_THE_TOLERANCE_USED',
    sameBytes.ok && tookAt(sameBytes.notes, 7) && toleranceRow(sameBytes.out) === sha('7'),
    sameBytes.ok ? `copy ${relative(home, copy)}; tolerance 7: ${tookAt(sameBytes.notes, 7)}; stamp row = sha256("7"): ${toleranceRow(sameBytes.out) === sha('7')}` : sameBytes.text);

  // Different files: refused, naming both and the field.
  const other = writeJson('other/requirements.json', { ...requirements, setup_painting: { ...requirements.setup_painting, rgb_tolerance: 8 } });
  const different = run('different', cfg, other);
  say('URQ04_A_FLAG_AND_A_CONFIG_NAMING_DIFFERENT_FILES_ARE_REFUSED',
    !different.ok && different.code === 'BUILD_REQUIREMENTS_CONFLICT' &&
      different.text.includes(`--requirements ${other} and config.requirements "requirements.json"`) &&
      different.text.includes(`(sha256 ${sha(readFileSync(other)).slice(0, 16)})`) && different.text.includes(`${tolerated} (sha256 ${flagDigest})`) &&
      different.text.endsWith("; the flag's file gives assembly setup_painting.rgb_tolerance (a region take)") && !existsSync(different.out),
    different.text || 'accepted');

  // Nothing reaches assembly: no region take, plain ground. The flag-only file is accepted and moves no byte.
  const untaken = { ...assembleOf };
  delete untaken.take;
  const noTake = { ...undeclared, assemble: untaken };
  const without = run('plain-without', noTake, undefined);
  const withFlag = run('plain-flag', noTake, tolerated);
  say('URQ05_A_FLAG_ONLY_FILE_THAT_REACHES_NO_ASSEMBLY_INPUT_IS_ACCEPTED_BYTE_IDENTICAL',
    without.ok && withFlag.ok && tree(without.out) === tree(withFlag.out),
    `without flag ${without.ok ? 'accepted' : without.text}; flag-only ${withFlag.ok ? 'accepted' : withFlag.text}; outputs identical: ${tree(without.out) === tree(withFlag.out)}`);

  // Busy-visible: the setup figure mask reaches assembly.
  const mask = newRaster(64, 64);
  mask.data.fill(255);
  writeFileSync(join(home, 'mask.png'), encodePngBytes(mask));
  const maskDeclaration = { path: 'mask.png', sha256: sha(readFileSync(join(home, 'mask.png'))) };
  const masked = writeJson('masked.json', { ...requirements, setup_painting: { ...requirements.setup_painting, figure_mask: maskDeclaration } });
  const busy = { ...noTake, assemble: { ...untaken, ground: 'busy', project: 'visible' } };
  const busyFlagOnly = run('busy-flag-only', busy, masked);
  say('URQ06_FLAG_ONLY_FIGURE_MASK_UNDER_BUSY_VISIBLE_IS_REFUSED',
    !busyFlagOnly.ok && busyFlagOnly.code === 'ASSEMBLE_REQUIREMENTS_UNDECLARED' &&
      busyFlagOnly.text.includes(`gives assembly setup_painting.figure_mask (busy-visible), and config.requirements is absent`) && !existsSync(busyFlagOnly.out),
    busyFlagOnly.text || 'accepted');
  const busyNamed = run('busy-named', { ...busy, requirements: 'masked.json' }, relative(process.cwd(), masked));
  const busyConfigOnly = run('busy-config-only', { ...busy, requirements: 'masked.json' }, undefined);
  say('URQ07_A_FLAG_NAMING_THE_CONFIG_S_FIGURE_MASK_FILE_IS_ACCEPTED',
    busyNamed.ok && busyConfigOnly.ok && tree(busyNamed.out) === tree(busyConfigOnly.out) && setupRow(busyNamed.out),
    `flag + config ${busyNamed.ok ? 'accepted' : busyNamed.text}; config only ${busyConfigOnly.ok ? 'accepted' : busyConfigOnly.text}; outputs identical: ${tree(busyNamed.out) === tree(busyConfigOnly.out)}; stamp binds requirements.setup_painting: ${busyNamed.ok && setupRow(busyNamed.out)}`);
  const unmasked = writeJson('unmasked.json', requirements);
  const busyWithout = run('busy-without', busy, undefined);
  const busyUnmasked = run('busy-unmasked', busy, unmasked);
  say('URQ08_A_FLAG_ONLY_SETUP_PAINTING_WITHOUT_A_FIGURE_MASK_UNDER_BUSY_VISIBLE_IS_ACCEPTED_BYTE_IDENTICAL',
    busyWithout.ok && busyUnmasked.ok && tree(busyWithout.out) === tree(busyUnmasked.out),
    `without flag ${busyWithout.ok ? 'accepted' : busyWithout.text}; flag-only, no figure_mask ${busyUnmasked.ok ? 'accepted' : busyUnmasked.text}; outputs identical: ${tree(busyWithout.out) === tree(busyUnmasked.out)}`);

  // A whole-layer take (no seed) reads no tolerance: a flag-only file beside it reaches nothing.
  const whole = join(dir, 'whole-layer');
  writeTakeFixture(whole);
  const wholeFlag = join(whole, 'requirements.json');
  writeFileSync(wholeFlag, JSON.stringify({ ...requirements, setup_painting: { ...requirements.setup_painting, rgb_tolerance: 7 } }));
  const wholeRun = (out: string, flag: string | undefined): string => {
    try {
      assembleStage({ source: join(whole, 'painting.png'), full: join(whole, 'full'), head: null, config: join(whole, 'config.json'), seam: 'near-white', project: 'core', ...(flag === undefined ? {} : { requirements: flag }) },
        { partsJson: join(whole, out, 'parts.json'), partsDir: join(whole, out, 'parts'), recomposite: join(whole, out, 'recomposite.png'), errorMap: join(whole, out, 'error.png') }, () => {});
      return 'accepted';
    } catch (error) { if (error instanceof PartsError) return error.message; throw error; }
  };
  const wholeWithout = wholeRun('without', undefined), wholeWith = wholeRun('flag', wholeFlag);
  say('URQ09_A_FLAG_ONLY_FILE_BESIDE_A_WHOLE_LAYER_TAKE_IS_ACCEPTED_BYTE_IDENTICAL',
    wholeWithout === 'accepted' && wholeWith === 'accepted' && tree(join(whole, 'without')) === tree(join(whole, 'flag')),
    `without flag ${wholeWithout}; flag-only ${wholeWith}; outputs identical: ${tree(join(whole, 'without')) === tree(join(whole, 'flag'))}`);

  // Issue #1419: `assemble --emit-fill-masks` reads requirements for a region take by the same rule as `--out`.
  const fillHome = join(dir, 'fill-masks');
  const fillCfgBase = writeTakeRegionFixture(fillHome);
  const cliPath = join(import.meta.dir, '..', 'cli.ts');
  // Cut polygon [4, 24) x [36, 44) (160 rig px) spans three zones on y in [36, 44):
  // - x in [4, 8) (32 px): wrong-colour donor protrusion (Z), rejected at rgb_tolerance 0;
  // - x in [8, 20) (96 px): hole in base full/parts/topwear.png, opaque only because the region take filled it from donor;
  // - x in [20, 24) (32 px): base body pixels already opaque before the region take.
  const cutEntry = { from: 'body', into: 'patch_cut', polygon: [[4, 36], [24, 36], [24, 44], [4, 44]], draw: 'front', overlap: 2 };
  const fillCfg: Record<string, unknown> = { ...fillCfgBase, assemble: { ...(fillCfgBase.assemble as Record<string, unknown>), cuts: [cutEntry] } };
  const fillWriteJson = (name: string, value: unknown): string => {
    const path = join(fillHome, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const fillCfgPath = fillWriteJson('config.json', fillCfg);
  const fillReqsPath = join(fillHome, 'requirements.json');
  const runEmitCli = (name: string, configPath: string, flag?: string): { status: number; out: string; masksDir: string } => {
    const masksDir = join(fillHome, `masks-${name}`);
    const args = [cliPath, 'assemble', '--source', join(fillHome, 'painting.png'), '--full', join(fillHome, 'full'), '--config', configPath,
      ...(flag === undefined ? [] : ['--requirements', flag]), '--emit-fill-masks', masksDir];
    const proc = spawnSync('bun', args, { encoding: 'utf8' });
    return { status: proc.status ?? -1, out: `${proc.stdout ?? ''}${proc.stderr ?? ''}`.trim().replaceAll('\n', ' '), masksDir };
  };
  const runOutStage = (name: string, configPath: string, flag?: string): { ok: boolean; res?: AssembleResult; code: string; text: string; outDir: string } => {
    const outDir = join(fillHome, `out-${name}`);
    try {
      const res = assembleStage(
        { source: join(fillHome, 'painting.png'), full: join(fillHome, 'full'), head: null, config: configPath, ...(flag === undefined ? {} : { requirements: flag }) },
        { partsJson: join(outDir, 'parts.json'), partsDir: join(outDir, 'parts'), recomposite: join(outDir, 'recomposite.png'), errorMap: join(outDir, 'error.png') },
        () => {},
      );
      return { ok: true, res, code: '', text: '', outDir };
    } catch (error) {
      if (!(error instanceof PartsError)) throw error;
      return { ok: false, code: error.problems.map(p => p.code).join(','), text: error.message, outDir };
    }
  };

  // EFM01: region take + tolerance in config.requirements + one cut: --emit-fill-masks exits 0 and matches --out's taken-region cut piece and cutFillMasks bytes.
  const emitCfgOnly = runEmitCli('config-only', fillCfgPath, undefined);
  const outCfgOnly = runOutStage('config-only', fillCfgPath, undefined);
  const maskPngPath = join(emitCfgOnly.masksDir, 'patch_cut.png');
  const maskBytes = existsSync(maskPngPath) ? readFileSync(maskPngPath) : null;
  const outMaskBytes = outCfgOnly.res?.cutFillMasks?.[0] === undefined ? null : encodePngBytes(outCfgOnly.res.cutFillMasks[0].mask);
  const maskDecoded = maskBytes === null ? null : decodePngBytes(maskBytes, maskPngPath);
  const outParts = outCfgOnly.ok ? readParts(join(outCfgOnly.outDir, 'parts.json')) : null;
  const outCutRec = outParts?.parts.find(p => p.name === 'patch_cut') ?? null;
  const outCutImg = outCutRec === null ? null : decodePngBytes(readFileSync(join(outCfgOnly.outDir, 'parts', 'patch_cut.png')), 'patch_cut.png');
  const baseTopwear = decodePngBytes(readFileSync(join(fillHome, 'full', 'parts', 'topwear.png')), 'topwear.png');
  let whiteTotal = 0, whiteInTakenHole = 0, whiteInBase = 0, whiteInProtrusion = 0, baseOpaqueInHole = 0, gridMatchesOutPiece = maskDecoded !== null && outCutRec !== null && outCutImg !== null;
  if (maskDecoded !== null && outCutRec !== null && outCutImg !== null) {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const mi = (y * 64 + x) * 4;
        const isWhite = maskDecoded.data[mi] === 255 && maskDecoded.data[mi + 1] === 255 && maskDecoded.data[mi + 2] === 255 && maskDecoded.data[mi + 3] === 255;
        const isZero = maskDecoded.data[mi] === 0 && maskDecoded.data[mi + 1] === 0 && maskDecoded.data[mi + 2] === 0 && maskDecoded.data[mi + 3] === 0;
        if (!isWhite && !isZero) gridMatchesOutPiece = false;
        const inPieceBox = x >= outCutRec.x && x < outCutRec.x + outCutRec.w && y >= outCutRec.y && y < outCutRec.y + outCutRec.h;
        const pieceAlpha = inPieceBox ? outCutImg.data[((y - outCutRec.y) * outCutRec.w + (x - outCutRec.x)) * 4 + 3] : 0;
        if (isWhite !== (pieceAlpha > 0)) gridMatchesOutPiece = false;
        if (isWhite) {
          whiteTotal++;
          if (x >= 4 && x < 8 && y >= 36 && y < 44) whiteInProtrusion++;
          else if (x >= 8 && x < 20 && y >= 36 && y < 44) whiteInTakenHole++;
          else if (x >= 20 && x < 24 && y >= 36 && y < 44) whiteInBase++;
        }
        if (x >= 8 && x < 20 && y >= 36 && y < 44) {
          const bi = ((y - 32) * baseTopwear.width + (x - 8)) * 4 + 3;
          if (baseTopwear.data[bi] > 0) baseOpaqueInHole++;
        }
      }
    }
  }
  const maskHashMatchesOut = maskBytes !== null && outMaskBytes !== null && sha(maskBytes) === sha(outMaskBytes);
  say('EFM01_REGION_TAKE_CONFIG_REQUIREMENTS_EMITS_FILL_MASK_MATCHING_OUT_TAKEN_REGION',
    emitCfgOnly.status === 0 && outCfgOnly.ok && maskHashMatchesOut && gridMatchesOutPiece &&
      whiteTotal === 128 && whiteInTakenHole === 96 && whiteInBase === 32 && whiteInProtrusion === 0 && baseOpaqueInHole === 0 &&
      outCutRec?.x === 8 && outCutRec.y === 36 && outCutRec.w === 16 && outCutRec.h === 8 && outCutRec.opaque_px === 128,
    `emit exit ${emitCfgOnly.status}${emitCfgOnly.status === 0 ? '' : ` (${emitCfgOnly.out})`}, sha=${maskBytes === null ? 'absent' : sha(maskBytes).slice(0, 12)} matches --out cutFillMasks=${maskHashMatchesOut} and --out parts/patch_cut.png (${outCutRec?.w}x${outCutRec?.h} @ ${outCutRec?.x},${outCutRec?.y})=${gridMatchesOutPiece}; white=${whiteTotal} (taken hole [8,20)x[36,44)=${whiteInTakenHole} where base opaque=${baseOpaqueInHole}, base [20,24)x[36,44)=${whiteInBase}, wrong-colour donor protrusion [4,8)x[36,44)=${whiteInProtrusion})`);

  // EFM02: passing --requirements naming the config's file (or a copy of the same bytes) is accepted and byte-identical to the config-only run.
  const emitWithFlag = runEmitCli('with-flag', fillCfgPath, relative(process.cwd(), fillReqsPath));
  const fillCopyReqs = join(fillHome, 'copies', 'requirements.json');
  mkdirSync(join(fillHome, 'copies'), { recursive: true });
  cpSync(fillReqsPath, fillCopyReqs);
  const emitWithCopy = runEmitCli('with-copy', fillCfgPath, fillCopyReqs);
  const flagIdentical = maskBytes !== null && tree(emitCfgOnly.masksDir) === tree(emitWithFlag.masksDir);
  const copyIdentical = maskBytes !== null && tree(emitCfgOnly.masksDir) === tree(emitWithCopy.masksDir);
  say('EFM02_REGION_TAKE_FLAG_NAMING_CONFIG_REQUIREMENTS_IS_ACCEPTED_BYTE_IDENTICAL',
    emitWithFlag.status === 0 && emitWithCopy.status === 0 && flagIdentical && copyIdentical,
    `flag exit ${emitWithFlag.status}, copy exit ${emitWithCopy.status}; masks identical to config-only: flag=${flagIdentical}, copy=${copyIdentical}`);

  // EFM03: a flag-only requirements file with a region take is refused as ASSEMBLE_REQUIREMENTS_UNDECLARED (and a conflicting file as BUILD_REQUIREMENTS_CONFLICT), as in --out mode.
  const fillUndeclaredCfg = { ...fillCfg };
  delete fillUndeclaredCfg.requirements;
  const fillUndeclaredPath = fillWriteJson('undeclared.json', fillUndeclaredCfg);
  const emitFlagOnly = runEmitCli('flag-only', fillUndeclaredPath, fillReqsPath);
  const outFlagOnly = runOutStage('flag-only', fillUndeclaredPath, fillReqsPath);
  const fillOtherReqs = fillWriteJson('other/requirements.json', { ...requirements, setup_painting: { ...requirements.setup_painting, rgb_tolerance: 8 } });
  const emitConflict = runEmitCli('conflict', fillCfgPath, fillOtherReqs);
  const outConflict = runOutStage('conflict', fillCfgPath, fillOtherReqs);
  say('EFM03_REGION_TAKE_FLAG_ONLY_OR_CONFLICTING_REQUIREMENTS_IS_REFUSED_AS_IN_OUT',
    emitFlagOnly.status === 1 && !outFlagOnly.ok && outFlagOnly.code === 'ASSEMBLE_REQUIREMENTS_UNDECLARED' &&
      emitFlagOnly.out.includes(`FAIL  ${outFlagOnly.text}`) && !existsSync(emitFlagOnly.masksDir) &&
      emitConflict.status === 1 && !outConflict.ok && outConflict.code === 'BUILD_REQUIREMENTS_CONFLICT' &&
      emitConflict.out.includes(`FAIL  ${outConflict.text}`) && !existsSync(emitConflict.masksDir),
    `flag-only exit ${emitFlagOnly.status} (${outFlagOnly.code}, matches --out=${emitFlagOnly.out.includes(`FAIL  ${outFlagOnly.text}`)}, dir absent=${!existsSync(emitFlagOnly.masksDir)}); conflict exit ${emitConflict.status} (${outConflict.code}, matches --out=${emitConflict.out.includes(`FAIL  ${outConflict.text}`)}, dir absent=${!existsSync(emitConflict.masksDir)})`);

  // EFM04: no tolerance anywhere (neither config.requirements nor --requirements, or a requirements file without setup_painting.rgb_tolerance) is refused as ASSEMBLE_REGION_TAKE_TOLERANCE, as in --out mode.
  const emitNoFile = runEmitCli('no-file', fillUndeclaredPath, undefined);
  const outNoFile = runOutStage('no-file', fillUndeclaredPath, undefined);
  const noTolReqs = fillWriteJson('no-tolerance-reqs.json', { spec: 'spine-parts-requirements/1', fps: 1, targets: [], requirements: [] });
  const noTolCfgPath = fillWriteJson('no-tolerance-cfg.json', { ...fillCfg, requirements: 'no-tolerance-reqs.json' });
  const emitNoTol = runEmitCli('no-tol', noTolCfgPath, undefined);
  const outNoTol = runOutStage('no-tol', noTolCfgPath, undefined);
  say('EFM04_REGION_TAKE_WITHOUT_TOLERANCE_IS_REFUSED_AS_IN_OUT',
    emitNoFile.status === 1 && !outNoFile.ok && outNoFile.code === 'ASSEMBLE_REGION_TAKE_TOLERANCE' &&
      emitNoFile.out.includes(`FAIL  ${outNoFile.text}`) && !existsSync(emitNoFile.masksDir) &&
      emitNoTol.status === 1 && !outNoTol.ok && outNoTol.code === 'ASSEMBLE_REGION_TAKE_TOLERANCE' &&
      emitNoTol.out.includes(`FAIL  ${outNoTol.text}`) && !existsSync(emitNoTol.masksDir),
    `no-file exit ${emitNoFile.status} (matches --out=${emitNoFile.out.includes(`FAIL  ${outNoFile.text}`)}, dir absent=${!existsSync(emitNoFile.masksDir)}); no-tolerance exit ${emitNoTol.status} (matches --out=${emitNoTol.out.includes(`FAIL  ${outNoTol.text}`)}, dir absent=${!existsSync(emitNoTol.masksDir)})`);

  // EFM05: a config with no region take writes the exact main bytes on the #1230 cut fixture, and a flag-only requirements file beside it moves no byte.
  const noRegionHome = join(fillHome, 'no-region-1230');
  mkdirSync(noRegionHome, { recursive: true });
  const W = 64, H = 64;
  const sourceRaster = newRaster(W, H);
  const layerRaster = newRaster(W, H);
  const faceLayers = (['face', 'eyewhite-r', 'eyewhite-l'] as const).map((name, k) => {
    const px = newRaster(W, H);
    for (let y = 2; y < 10; y++) for (let x = 2 + k * 10; x < 10 + k * 10; x++) px.data.set([90, 90, 90, 255], (y * W + x) * 4);
    return { name, tag: readLayerTag(name)!, pixels: px, file: null, left: 0, top: 0, right: W, bottom: H, depth: 0.4 - k * 0.01, drawOrder: k, opaquePx: 64 };
  });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    if (x >= 24 && x < 40 && y >= 20 && y < 44) {
      sourceRaster.data.set([210, 60, 70, 255], idx);
      layerRaster.data.set([210, 60, 70, 255], idx);
    } else if (x >= 16 && x < 48 && y >= 12 && y < 52) {
      sourceRaster.data.set([70, 90, 160, 255], idx);
      layerRaster.data.set([70, 90, 160, 255], idx);
    } else {
      sourceRaster.data.set([245, 245, 245, 255], idx);
    }
  }
  for (const fl of faceLayers) for (let i = 0; i < W * H; i++) if (fl.pixels.data[i * 4 + 3] > 0) sourceRaster.data.set([90, 90, 90, 255], i * 4);
  const noRegionSource = join(noRegionHome, 'source.png');
  writeFileSync(noRegionSource, encodePngBytes(sourceRaster));
  const noRegionFull = join(noRegionHome, 'full');
  exportLayers({
    form: 'wrapper',
    source: 'synthetic-cut',
    canvas: { w: W, h: H },
    layers: [...faceLayers, { name: 'bottomwear', tag: readLayerTag('bottomwear')!, pixels: layerRaster, file: null, left: 0, top: 0, right: W, bottom: H, depth: 0.5, drawOrder: 3, opaquePx: 1280 }],
    hidden: [],
  }, noRegionFull);
  const noRegionBaseCfg = assembleConfig({
    plan: [['face', 'full', 'face'], ['eye_r', 'full', 'eyewhite-r'], ['eye_l', 'full', 'eyewhite-l'], ['skirt', 'full', 'bottomwear']],
    extend: [],
    resolution: W,
    rigScale: 1,
  });
  delete (noRegionBaseCfg.seethrough as Record<string, unknown>).head_box;
  const noRegionCfgPath = join(noRegionHome, 'config.json');
  writeFileSync(noRegionCfgPath, JSON.stringify({
    ...noRegionBaseCfg,
    assemble: { ...(noRegionBaseCfg.assemble as Record<string, unknown>), cuts: [{ from: 'skirt', into: 'sash', polygon: [[24, 20], [40, 20], [40, 44], [24, 44]], draw: 'front', overlap: 2 }] },
    regions: { face: 'root', eye_r: 'root', eye_l: 'root', skirt: 'root', sash: 'root' },
    meshes: {},
  }, null, 2));
  const noRegionMasksPlain = join(noRegionHome, 'masks-plain');
  const noRegionMasksFlag = join(noRegionHome, 'masks-flag');
  const noRegionRunPlain = spawnSync('bun', [cliPath, 'assemble', '--source', noRegionSource, '--full', noRegionFull, '--config', noRegionCfgPath, '--emit-fill-masks', noRegionMasksPlain], { encoding: 'utf8' });
  const noRegionRunFlag = spawnSync('bun', [cliPath, 'assemble', '--source', noRegionSource, '--full', noRegionFull, '--config', noRegionCfgPath, '--requirements', fillReqsPath, '--emit-fill-masks', noRegionMasksFlag], { encoding: 'utf8' });
  const expectedMainSashSha = 'bf5c61dcd07516f89cb850e66418d6dae4545f2e39ede207dce54e1a2508a310';
  const sashPlainSha = existsSync(join(noRegionMasksPlain, 'sash.png')) ? sha(readFileSync(join(noRegionMasksPlain, 'sash.png'))) : 'absent';
  say('EFM05_NO_REGION_TAKE_EMIT_FILL_MASKS_IS_BYTE_IDENTICAL_TO_MAIN',
    noRegionRunPlain.status === 0 && noRegionRunFlag.status === 0 &&
      sashPlainSha === expectedMainSashSha && tree(noRegionMasksPlain) === tree(noRegionMasksFlag),
    `plain exit ${noRegionRunPlain.status}, sash.png sha256=${sashPlainSha} (want ${expectedMainSashSha}); flag-only exit ${noRegionRunFlag.status}, identical=${tree(noRegionMasksPlain) === tree(noRegionMasksFlag)}`);
}
