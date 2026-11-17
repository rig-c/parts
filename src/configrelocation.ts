/** Config writers relocate edited directories once, without rewriting authored receipt files. */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { configFileReferences } from './config.ts';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Preserve the public reference inventory while giving writers canonical edited-part paths. */
export function relocateConfigReferences(raw: unknown, configDir: string, out: string, mode: 'relative' | 'absolute'): void {
  const refs = configFileReferences(raw);
  const assemble = object(raw) ? raw.assemble : undefined;
  const edited = object(assemble) ? assemble.edited_parts : undefined;
  // Do not repair invalid dirs or replace the loader's existing relative-only refusals.
  if (object(edited) && typeof edited.dir === 'string' && edited.dir.trim() !== '' &&
    !isAbsolute(edited.dir) && !/^(?:[\\/]|[A-Za-z]:[\\/])/.test(edited.dir)) {
    edited.dir = relative(resolve(out), resolve(configDir, edited.dir)).split(sep).join('/') || '.';
  }
  for (const ref of refs) {
    if (ref.at.startsWith('assemble.edited_parts.receipts[')) continue;
    if (mode === 'absolute' && isAbsolute(ref.value)) continue;
    const target = resolve(configDir, ref.value);
    ref.set(mode === 'relative' ? relative(resolve(out), target) : target);
  }
}
