/** Issue #719: authored painting points, never inferred from geometry. */
import type { Problem } from './errors.ts';

export function setFocusProblems(value: unknown, object: string, size?: readonly number[]): Problem[] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))
    || value.some((n) => n < 0) || (size !== undefined && value.some((n, i) => n > size[i]))) {
    return [{ code: 'CONFIG_SET_FOCUS', object, detail: `is ${Array.isArray(value) ? '[' + value.map((n) => typeof n === 'number' ? String(n) : JSON.stringify(n)).join(', ') + ']' : String(JSON.stringify(value))}; exactly two finite painting-pixel coordinates [x, y]${size === undefined ? ', both non-negative' : ` inside the ${size[0]}x${size[1]} painting (edges included)`} are required; author the point or omit focus` }];
  }
  return [];
}

/** The conditional parts record retains the actual painting size, not a size guessed from rig_scale. */
export function recordedFocusProblems(record: { focus?: unknown; focus_source_size?: unknown }, object: string, rigSize: readonly number[], scale: number): Problem[] {
  if (!('focus' in record) && !('focus_source_size' in record)) return [];
  const size = record.focus_source_size;
  if (!('focus' in record) || !Array.isArray(size) || size.length !== 2 || !size.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0)
    || size.some((n, i) => Math.trunc(n * scale) !== rigSize[i])) {
    return [{ code: 'CONFIG_SET_FOCUS', object, detail: 'requires focus with its original positive integer focus_source_size [width, height] producing rig_size at scale_rig_per_source; re-run assemble' }];
  }
  return setFocusProblems(record.focus, object, size);
}
