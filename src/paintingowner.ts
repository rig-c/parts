import { type Mask, type Raster } from './raster/types.ts';

/** A named owner supplier, independent of the edge estimator and receivers. */
export interface PaintingOwner {
  supplier: string;
  names: readonly string[];
  pixels: Int32Array;
}

export interface PaintingReceivers extends PaintingOwner {
  receiverNames: readonly string[];
  roots: Int32Array;
  receivers: Int32Array;
  reasons: string[];
  faults: Array<{ receiver: string; reason: string }>;
}

/** Owner (a), the last raw plan layer at alpha >=128 on the rig canvas. */
export function rawPaintingOwner(raw: ReadonlyArray<{ name: string; raster: Raster }>, pixels: number): PaintingOwner {
  const owner = new Int32Array(pixels).fill(-1);
  raw.forEach(({ raster }, i) => {
    for (let p = 0; p < pixels; p++) if (raster.data[p * 4 + 3] >= 128) owner[p] = i;
  });
  return { supplier: 'owner-a/raw-plan-alpha>=128', names: raw.map(q => q.name), pixels: owner };
}

/** Resolve declared cut/limb ancestry, frozen support and production regions. */
export function paintingReceivers(
  owner: PaintingOwner,
  parts: ReadonlyArray<{ name: string; image: Raster; region: Mask | null }>,
  lineage: ReadonlyArray<readonly [string, string]>,
): PaintingReceivers {
  const parents = new Map<string, string[]>();
  for (const [from, into] of lineage) parents.set(into, [...(parents.get(into) ?? []), from]);
  const ancestors = (name: string, path: readonly string[] = []): string[] | null => {
    if (path.includes(name)) return null;
    const sources = parents.get(name) ?? [];
    if (sources.length === 0) return owner.names.includes(name) ? [name] : [];
    const roots: string[] = [];
    for (const source of sources) {
      const found = ancestors(source, [...path, name]);
      if (found === null) return null;
      roots.push(...found);
    }
    return [...new Set(roots)];
  };
  const roots = new Int32Array(parts.length).fill(-1);
  const faults: PaintingReceivers['faults'] = [];
  parts.forEach((part, i) => {
    const found = ancestors(part.name);
    if (found === null || found.length !== 1) {
      faults.push({ receiver: part.name, reason: found === null ? 'cycle' : found.length === 0 ? 'missing-lineage' : 'multiple-ancestors' });
    } else roots[i] = owner.names.indexOf(found[0]);
  });
  const receivers = new Int32Array(owner.pixels.length).fill(-1);
  const reasons = new Array<string>(owner.pixels.length).fill('no-owner');
  for (let p = 0; p < owner.pixels.length; p++) {
    if (owner.pixels[p] < 0) continue;
    let target = -1;
    let ambiguous = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (roots[i] !== owner.pixels[p] || part.image.data[p * 4 + 3] === 0 ||
        (part.region !== null && part.region.data[p] !== 1)) continue;
      if (target >= 0) { ambiguous = true; break; }
      target = i;
    }
    if (ambiguous) reasons[p] = 'multiple-receivers';
    else if (target < 0) reasons[p] = 'no-supported-receiver';
    else { receivers[p] = target; reasons[p] = 'unique'; }
  }
  return { ...owner, receiverNames: parts.map(q => q.name), roots, receivers, reasons, faults };
}

/** A refusal names the missing owner or the receiver contract it violates. */
export function paintingReceiverAt(input: PaintingReceivers, p: number): { target: number; reason: string } {
  const owner = input.pixels[p];
  if (owner === -2) return { target: -1, reason: 'mixed-owner' };
  if (owner < 0) return { target: -1, reason: 'no-owner' };
  if (input.names[owner] === undefined) return { target: -1, reason: 'unknown-owner' };
  const target = input.receivers[p];
  if (target < 0) return { target: -1, reason: input.reasons[p] };
  if (input.roots[target] !== owner) return { target: -1, reason: 'receiver-owner-mismatch' };
  return { target, reason: 'unique' };
}

/** Refused known-owner writes remain foreign to the receiver contract. */
export function foreignPaintingReceiver(input: PaintingReceivers, p: number, receiver: number): boolean {
  return input.pixels[p] >= 0 && (input.receivers[p] !== receiver || input.roots[receiver] !== input.pixels[p]);
}
