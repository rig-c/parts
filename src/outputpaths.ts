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
    encoded += /^[A-Za-z0-9_@+.-]$/.test(unit) && !(unit === '.' && i === name.length - 1)
      ? unit : escape(name.charCodeAt(i));
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(encoded)) encoded = escape(name.charCodeAt(0)) + encoded.slice(1);
  const segment = encoded + suffix;
  if (name.length === 0 || segment.length > 255) throw new PartsError([{
    code: 'DIAGNOSTIC_PATH_SEGMENT', object: `diagnostic name ${JSON.stringify(name)}`,
    detail: name.length === 0 ? 'is empty; a nonempty original name is required for a diagnostic filesystem segment'
      : `encodes to ${segment.length} characters including fixed suffix ${JSON.stringify(suffix)}; at most 255 are required for a diagnostic filesystem segment; shorten the original name, no truncation is applied`,
  }]);
  return segment;
}

/**
 * Why `dir`, a folder name another tool recorded, is not one safe path segment
 * Parts can join under its own output as it is, or `null` when it is (issue
 * #1367). Safe is the alphabet `diagnosticSegment` emits — `[A-Za-z0-9_@+.-]`
 * and its escape character `~` — with no final `.` (so neither `.` nor `..`),
 * no Windows device basename before the first dot, and 1 to 255 characters.
 * rig-c's render records every frame-set folder in that alphabet from
 * rig-c/core#1744 on; nothing here maps or repairs the value.
 */
export function unsafeSegmentReason(dir: unknown): string | null {
  if (typeof dir !== 'string') return dir === undefined ? 'is absent' : `is ${dir === null ? 'null' : typeof dir}, not a string`;
  if (dir.length === 0) return 'is empty';
  if (/^[\\/]/.test(dir)) return 'is an absolute path';
  if (dir === '.' || dir === '..' || /(?:^|[\\/])\.\.?(?:[\\/]|$)/.test(dir)) return 'holds a dot segment';
  if (/[\\/]/.test(dir)) return 'holds a path separator';
  let unit = 0;
  while (unit < dir.length && /^[A-Za-z0-9_@+.~-]$/.test(dir[unit])) unit++;
  if (unit < dir.length) return `holds ${JSON.stringify(dir[unit])} (U+${dir.charCodeAt(unit).toString(16).padStart(4, '0')}) outside [A-Za-z0-9_@+.~-]`;
  if (dir.endsWith('.')) return 'ends with "."';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(dir)) return 'is a Windows device name before its first dot';
  if (dir.length > 255) return `is ${dir.length} characters`;
  return null;
}

/** Validate the entire sibling scope before a caller creates any of its paths. */
export function diagnosticSiblings(names: readonly { name: string; suffix?: string }[], scope: string): string[] {
  const seen = new Map<string, { name: string; folder: string }>();
  return names.map(({ name, suffix }) => {
    const folder = diagnosticSegment(name, suffix);
    const folded = folder.toLowerCase(); // Mapped segments contain ASCII only.
    const previous = seen.get(folded);
    if (previous !== undefined) throw new PartsError([{
      code: 'DIAGNOSTIC_PATH_SEGMENT', object: `diagnostic names ${JSON.stringify(previous.name)} and ${JSON.stringify(name)}`,
      detail: `folders ${JSON.stringify(previous.folder)} and ${JSON.stringify(folder)} share ASCII-case-folded folder ${JSON.stringify(folded)} in sibling scope ${JSON.stringify(scope)}; distinct case-folded sibling folders are required`,
    }]);
    seen.set(folded, { name, folder });
    return folder;
  });
}
