import { readFileSync } from 'node:fs';

/** Read Markdown with LF line endings for line and section comparisons. */
export function readDocument(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
}
