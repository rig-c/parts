/** Issue #1418: a --requirements file whose content reaches assembly must be the one config.requirements names. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { assembleStage } from '../src/build.ts';
import { PartsError } from '../src/errors.ts';
import { REGION_TOLERANCE_FIELD } from '../src/assembly-reading.ts';
import { newRaster } from '../src/raster/types.ts';
import { encodePngBytes } from '../src/raster/png.ts';

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
      flagOnly.text === `ASSEMBLE_REQUIREMENTS_UNDECLARED: --requirements ${tolerated} — ${tolerated} (sha256 ${flagDigest}) gives assembly setup_painting.rgb_tolerance (a region take), and config.requirements is absent; assembly_config reads only config.requirements, so a file that reaches assembly must be named there — add "requirements": "<this file, relative to the config's directory>" to the config` &&
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
}
