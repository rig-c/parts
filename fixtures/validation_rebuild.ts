/** Actual memo invalidation: one source byte, one new producer, then reuse. */
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validationBuild, validationBuildSeconds, validationDigest, type ValidationBuild } from './validation_cache.ts';
export function validationRebuildProbe(root: string, cache: string, head: string, original: ValidationBuild, clone: string): { ok: boolean; detail: string } {
  const before = validationDigest(original.input);
  cpSync(original.input, clone, { recursive: true });
  const config = join(clone, 'config.json');
  const bytes = readFileSync(config, 'utf8');
  const changed = bytes.replace('"seed": 1', '"seed": 2');
  const changes = [...Buffer.from(bytes)].filter((value, i) => value !== Buffer.from(changed)[i]).length;
  if (changes !== 1 || bytes.length !== changed.length) throw new Error('memo defect must change exactly one declared input byte');
  writeFileSync(config, changed);
  const secondsBefore = validationBuildSeconds(cache);
  const rebuilt = validationBuild(root, cache, head, 'standard', clone);
  const secondsAfter = validationBuildSeconds(cache);
  const reused = validationBuild(root, cache, head, 'standard', clone);
  const sameOutput = rebuilt !== null && readFileSync(join(rebuilt.out, 'rig', 'rig.json'), 'utf8') === readFileSync(join(original.out, 'rig', 'rig.json'), 'utf8');
  const ok = rebuilt !== null && reused !== null && !rebuilt.reused && reused.reused && rebuilt.key !== original.key && reused.key === rebuilt.key &&
    secondsAfter > secondsBefore && validationBuildSeconds(cache) === secondsAfter && validationDigest(original.input) === before && sameOutput;
  return { ok, detail: `changed input bytes ${changes}; original ${original.key}; rebuilt ${rebuilt?.key}; fresh ${rebuilt?.reused === false}, then reuse ${reused?.reused}; exactly one producer added ${(secondsAfter - secondsBefore).toFixed(3)} s; unchanged rig ${sameOutput}; original input unchanged ${validationDigest(original.input) === before}` };
}
