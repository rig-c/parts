/** Compare stable scene bytes while reporting Core's two per-run clock fields separately. */
export interface SceneParityDifference {
  path: string;
  clockOnly: boolean;
  fields: string[];
}
export interface SceneParity {
  rawEqual: boolean;
  stableEqual: boolean;
  differences: SceneParityDifference[];
}

export function compareSceneBytes(before: ReadonlyMap<string, Uint8Array>, after: ReadonlyMap<string, Uint8Array>): SceneParity {
  const differences: SceneParityDifference[] = [];
  const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const left = before.get(path), right = after.get(path);
    if (left !== undefined && right !== undefined && Buffer.from(left).equals(Buffer.from(right))) continue;
    let clockOnly = false;
    let fields: string[] = [];
    // sceneOutputFiles uses the host separator; only this exact relative receipt is approved.
    const relativePath = path.replaceAll('\\', '/');
    if (relativePath === 'check/build/run.json' && left !== undefined && right !== undefined) {
      try {
        const a: unknown = JSON.parse(new TextDecoder().decode(left));
        const b: unknown = JSON.parse(new TextDecoder().decode(right));
        if (record(a) && record(b)) {
          fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
          const clocks = ['started_at', 'finished_at'];
          const validClocks = [a, b].every(o => clocks.every(k => typeof o[k] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(o[k]) && Number.isFinite(Date.parse(o[k]))));
          const stable = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !clocks.includes(k)));
          clockOnly = validClocks && fields.length > 0 && fields.every(k => clocks.includes(k)) && JSON.stringify(stable(a)) === JSON.stringify(stable(b));
        }
      } catch { /* Unreadable receipts differ; nothing is silently excluded. */ }
    }
    differences.push({ path, clockOnly, fields });
  }
  return { rawEqual: differences.length === 0, stableEqual: differences.every(d => d.clockOnly), differences };
}
