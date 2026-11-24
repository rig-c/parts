/** Config writers relocate edited directories once, without rewriting authored receipt files. */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { configFileReferences } from './config.ts';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The public reference inventory predates assembly fingerprinting. Writers
// must also preserve these config-relative assembly inputs at their new base.
function relocateAssemblyFiles(raw: unknown, relocate: (value: string) => string): void {
  const fields = (entry: unknown, keys: readonly string[]): void => {
    if (!object(entry)) return;
    for (const key of keys) {
      const value = entry[key];
      if (typeof value === 'string' && value !== '' && !isAbsolute(value)) entry[key] = relocate(value);
    }
  };
  const entries = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(object) : [];
  const cuts = (value: unknown): void => {
    for (const cut of entries(value)) {
      fields(cut, ['under']);
      fields(cut.under, ['plate']);
    }
  };
  if (!object(raw)) return;
  if (object(raw.assemble)) {
    cuts(raw.assemble.cuts);
    for (const alt of entries(raw.assemble.alternates)) {
      fields(alt, ['source', 'full', 'head', 'skeleton']);
      cuts(alt.cuts);
    }
    for (const take of entries(raw.assemble.take)) {
      fields(take, ['run_dir', 'st_input']);
      fields(take.reference, ['painting']);
    }
    if (object(raw.assemble.editor_receipts)) {
      for (const receipt of entries(raw.assemble.editor_receipts.receipts)) fields(receipt, ['file']);
    }
  }
  if (object(raw.limbs)) {
    for (const limb of Object.values(raw.limbs).filter(object)) {
      for (const segment of entries(limb.segments)) fields(segment, ['cap']);
    }
  }
  if (object(raw.depth)) {
    for (const run of [raw.depth.full, raw.depth.head].filter(object)) {
      fields(run.atlas, ['image']);
      if (object(run.layers)) for (const layer of Object.values(run.layers)) fields(layer, ['image']);
    }
  }
}

/** Preserve the public reference inventory while giving writers canonical edited-part paths. */
export function relocateConfigReferences(raw: unknown, configDir: string, out: string, mode: 'relative' | 'absolute'): void {
  const pathAt = (value: string): string => {
    const target = resolve(configDir, value);
    return mode === 'relative' ? relative(resolve(out), target) || '.' : target;
  };
  const refs = configFileReferences(raw);
  relocateAssemblyFiles(raw, pathAt);
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
    ref.set(pathAt(ref.value));
  }
}
