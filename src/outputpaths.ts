import { PartsError } from './errors.ts';

/**
 * Filesystem spelling for a diagnostic name. See STABILITY's "Diagnostic path
 * segments" for the single public definition. Encode code units, not UTF-8:
 * even an unpaired surrogate has its own spelling rather than U+FFFD's.
 */
export function diagnosticSegment(name: string, suffix = ''): string {
  let encoded = '';
  const escape = (unit: number): string => '~' + unit.toString(16).padStart(4, '0');
  for (let i = 0; i < name.length; i++) {
    const unit = name[i];
    encoded += /^[a-z0-9_@+.-]$/.test(unit) && !(unit === '.' && i === name.length - 1)
      ? unit : escape(name.charCodeAt(i));
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(encoded)) encoded = escape(name.charCodeAt(0)) + encoded.slice(1);
  const segment = encoded + suffix;
  if (name.length === 0 || segment.length > 255) throw new PartsError([{
    code: 'DIAGNOSTIC_PATH_SEGMENT', object: `diagnostic name ${JSON.stringify(name)}`,
    detail: name.length === 0 ? 'is empty; a nonempty original name is required for a diagnostic filesystem segment'
      : `encodes to ${segment.length} characters including fixed suffix ${JSON.stringify(suffix)}; at most 255 are required for a diagnostic filesystem segment; shorten the original name, no truncation is applied`,
  }]);
  return segment;
}
