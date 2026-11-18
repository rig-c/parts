/**
 * Filesystem spelling for a diagnostic name. See STABILITY's "Diagnostic path
 * segments" for the single public definition. Encode code units, not UTF-8:
 * even an unpaired surrogate has its own spelling rather than U+FFFD's.
 */
export function diagnosticSegment(name: string): string {
  if (/^[a-z0-9_@+.-]+$/.test(name) && name !== '.' && name !== '..' &&
      !name.endsWith('.') && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(name)) return name;
  let encoded = '~';
  for (let i = 0; i < name.length; i++) encoded += name.charCodeAt(i).toString(16).padStart(4, '0');
  return encoded;
}
