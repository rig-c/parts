import type { AlternateCliInput } from '../src/build.ts';

/** Parse `--alt <name>=<source>:<full>[:<head>]` (issue #454), or return a usage message. */
export function parseAltArg(value: string): AlternateCliInput | string {
  const eq = value.indexOf('=');
  if (eq <= 0) return `--alt "${value}" is not <name>=<source>:<full>[:<head>]`;
  const name = value.slice(0, eq);
  if (name.startsWith('.') || name.includes('/') || name.includes('\\')) return `--alt set name "${name}" may not start with "." or hold a slash`;
  const rest = value.slice(eq + 1);
  const parts: string[] = [];
  const drivePrefix = /^[A-Za-z]:[\\/]/;
  let start = 0;
  for (let at = 0; at < rest.length; at++) {
    if (rest[at] !== ':') continue;
    // Only the leading drive colon of this segment belongs to its path.
    if (at === start + 1 && drivePrefix.test(rest.slice(start))) continue;
    parts.push(rest.slice(start, at));
    start = at + 1;
  }
  parts.push(rest.slice(start));
  if (parts.length < 2 || parts.length > 3 || parts[0].length === 0 || parts[1].length === 0 || (parts.length === 3 && parts[2].length === 0)) {
    return `--alt "${value}" is not <name>=<source>:<full>[:<head>]`;
  }
  return { name, source: parts[0], full: parts[1], ...(parts.length === 3 ? { head: parts[2] } : {}) };
}
