import { readFileSync } from 'node:fs';

// Issue #873 cut: 5,274 whitespace-delimited words; ceil(5274 * 1.1 / 50) * 50 = 5,850.
export const README_WORD_CAP = 5850;
export const README_HEADINGS: readonly string[] = [
  'What you get', 'What it takes in', 'What it gives out',
  'Painting → parts → rig → browser', 'Getting See-through layers',
  'The loop, for an agent', 'Commands', 'What it does not do',
  'Requirements', 'Licence posture', 'Development', 'Licence', 'Depth-driven rigging',
];

export function readmeWords(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

/** Report every policy violation; counting includes code, tables and markup. */
export function readmePolicyFaults(text: string): string[] {
  const faults: string[] = [];
  const words = readmeWords(text);
  if (words > README_WORD_CAP) faults.push(`README_WORD_CAP: ${words} words; at most ${README_WORD_CAP} required`);
  // Fenced examples are words too, but are not Markdown headings or tables.
  let fence: { char: string; length: number } | null = null;
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (marker) {
      if (fence === null) fence = { char: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^ {0,3}##[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/u.exec(line)?.[1];
    if (heading !== undefined && !README_HEADINGS.includes(heading)) faults.push(`README_HEADING: line ${index + 1} names "${heading}"; use the heading allowlist`);
    if (line.includes('|') && /\b\d{4}-\d{2}-\d{2}\b/u.test(line)) faults.push(`README_DATED_MEASUREMENT: line ${index + 1} holds a date inside a table cell`);
  }
  // Read across line wraps so reflow cannot conceal a dated reading.
  for (const match of text.matchAll(/\b(?:measured|read)\s+on\s+20\d*/giu)) {
    faults.push(`README_DATED_MEASUREMENT: dated phrase "${match[0].replace(/\s+/gu, ' ')}"; move the measurement to the reference`);
  }
  return faults;
}

type Say = (name: string, ok: boolean, detail: string) => void;

/** The CI entry and the tree suite exercise the same predicate and mutants. */
export function runReadmePolicyChecks(readme: string, say: Say): void {
  const good = '# Package\n\n## Commands\n\nOne first run.\n';
  const cases: readonly [string, string, string][] = [
    ['TY31_README_CAP_REFUSES_ONE_WORD_OVER', 'word '.repeat(README_WORD_CAP + 1), 'README_WORD_CAP'],
    ['TY32_README_HEADING_REFUSES_NEW_SECTION', good + '\n## Flag catalogue\n', 'README_HEADING'],
    ['TY33_README_REFUSES_DATED_MEASUREMENT', good + '\nMeasured on 2026-10-30.\n', 'README_DATED_MEASUREMENT'],
    ['TY34_README_REFUSES_WRAPPED_DATED_READING', good + '\nread\non 2026-10-30.\n', 'README_DATED_MEASUREMENT'],
    ['TY35_README_REFUSES_TABLE_DATE', good + '\n| input | 2026-10-30 |\n', 'README_DATED_MEASUREMENT'],
    ['TY37_README_REFUSES_TABLE_DATE_WITHOUT_EDGE_PIPES', good + '\ninput | 2026-10-30\n', 'README_DATED_MEASUREMENT'],
    ['TY38_README_REFUSES_TABLE_DATE_IN_FIRST_CELL', good + '\n2026-10-30 | input\n', 'README_DATED_MEASUREMENT'],
  ];
  const live = readmePolicyFaults(readme);
  say('TY30_README_POLICY', live.length === 0, `${readmeWords(readme)} words; cap ${README_WORD_CAP}; ${live.join('; ') || 'allowed headings and no dated measurements'}`);
  for (const [name, text, code] of cases) {
    const faults = readmePolicyFaults(text);
    say(name, faults.length === 1 && faults[0].startsWith(`${code}:`), `planted: ${faults.join('; ') || 'NOT REFUSED'}`);
  }
  const controls = [
    good, 'word '.repeat(README_WORD_CAP),
    good + '\n```md\n## Example heading\n| date | 2026-10-30 |\n```\n',
    good + '\n### Existing subsection\nReleased 2026-10-30.\n| version | 1.2.3 |\n',
  ];
  say('TY36_README_POLICY_POSITIVE_CONTROLS', controls.every(text => readmePolicyFaults(text).length === 0), 'normal page, exact cap, fenced examples and non-measurement prose dates accepted');
}

if (import.meta.main) {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  let failed = 0;
  runReadmePolicyChecks(readme, (name, ok, detail) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
    if (!ok) failed++;
  });
  process.exitCode = failed === 0 ? 0 : 1;
}
