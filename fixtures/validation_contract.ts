/** Focused metadata positives and named defects used by the sample feature unit. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PartsError } from '../src/errors.ts';
import { loadConfig, parseConfig } from '../src/config.ts';
import { writeSwitchedConfig } from '../tools/auto_motion_survey.ts';
import { runPartSourceChecks } from '../tools/check_part_sources.ts';
import { validationMetadataReadings } from './validation_metadata.ts';
import { validationInputReadings } from './validation_readers.ts';
export interface ValidationControl { name: string; ok: boolean; detail: string }
export function validationContractControls(input: string, dir: string): ValidationControl[] {
  mkdirSync(dir, { recursive: true });
  const rows: ValidationControl[] = [];
  const say = (name: string, ok: boolean, detail: string): void => { rows.push({ name, ok, detail }); };
  for (const [name, row] of Object.entries(validationMetadataReadings(input))) say(`metadata:${name}`, row.ok && row.defectRefused, row.detail);
  for (const [name, row] of Object.entries(validationInputReadings(input))) say(`inputs:${name}`, row.ok && row.defectRefused, row.detail);
  const raw = JSON.parse(readFileSync(join(input, 'config.json'), 'utf8')) as Record<string, unknown>;
  parseConfig(raw);
  const duplicate = structuredClone(raw);
  const tracks = (duplicate.motion as { tracks: unknown[] }).tracks;
  tracks.push(structuredClone(tracks[0]));
  let refused = false;
  try { parseConfig(duplicate); } catch (error) {
    if (!(error instanceof PartsError)) throw error;
    refused = error.problems.some(problem => problem.code === 'CONFIG_BONE_PROPERTY_KEYED_ONCE');
  }
  say('CF42:sample-duplicate-track', refused, 'clean sample loads; duplicated chest property is CONFIG_BONE_PROPERTY_KEYED_ONCE');
  const at = writeSwitchedConfig('validation', raw, join(dir, 'carried'), undefined, input);
  const carries = ['animations.json', 'requirements.json', 'pose.json'].every(name => readFileSync(join(dirname(at), name), 'utf8') === readFileSync(join(input, name), 'utf8'));
  loadConfig(at);
  mkdirSync(join(dir, 'alone')); writeFileSync(join(dir, 'alone', 'config.json'), JSON.stringify(raw));
  let alone = false;
  try { loadConfig(join(dir, 'alone', 'config.json')); } catch (error) {
    if (!(error instanceof PartsError)) throw error;
    alone = error.problems.some(problem => problem.code === 'CONFIG_FILE_PRESENT' && problem.object === 'config.motion.animations_from');
  }
  say('MO77:survey-carried-inputs', carries && alone, 'real writer carries exact imported files; lone config names CONFIG_FILE_PRESENT motion.animations_from');
  runPartSourceChecks(join(dir, 'source-checks'), (name, ok, detail) => { if (name === 'PUBLIC_EXAMPLES_TRACE_BUT_SCARF_PATCHES') say('SR12:trace-and-patch', ok, detail); }, join(input, 'config.json'));
  if (!rows.some(row => row.name.startsWith('SR12:'))) throw new Error('sample source control did not run');
  return rows;
}
