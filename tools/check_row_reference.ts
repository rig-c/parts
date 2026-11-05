/** Derive the consumer table from calls in the actual row producers. */
import ts from 'typescript';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROW_TABLE_BEGIN = '<!-- check-row-table:begin -->';
export const ROW_TABLE_END = '<!-- check-row-table:end -->';
export function checkRowTable(root: string): string {
  const families = new Map<string, { scopes: Set<string>; kinds: Set<string>; subjects: Set<string>; sites: string[] }>();
  const source = join(root, 'src');
  for (const file of readdirSync(source).filter(f => f.endsWith('.ts')).sort()) {
    const path = join(source, file), text = readFileSync(path, 'utf8');
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'checkRow') {
        const [family, scope, finding, subject] = node.arguments;
        if (node.arguments.length !== 4 || !ts.isStringLiteral(family)) throw new Error(`${file}: row family must be a literal with four arguments`);
        const show = (n: ts.Node): string => n.getText(tree).replace(/\s+/g, ' ').replaceAll('|', '&#124;');
        const row = families.get(family.text) ?? { scopes: new Set(), kinds: new Set(), subjects: new Set(), sites: [] };
        row.scopes.add(show(scope));
        row.kinds.add(finding.kind === ts.SyntaxKind.FalseKeyword ? 'evidence' : finding.kind === ts.SyntaxKind.TrueKeyword ? 'finding' : `finding when ${show(finding)}; otherwise evidence`);
        row.subjects.add(show(subject));
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        row.sites.push(`[${file}:${line}](../src/${file}#L${line})`);
        families.set(family.text, row);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  if (families.size === 0) throw new Error('no row producers found');
  return [ROW_TABLE_BEGIN, '| Row family | row_scope | row_kind | row_subjects (producer expression) | Producer |',
    '| --- | --- | --- | --- | --- |', ...[...families].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, row]) =>
      `| \`${name}\` | ${[...row.scopes].join('; ')} | ${[...row.kinds].join('; ')} | ${[...row.subjects].join('; ')} | ${row.sites.join(', ')} |`), ROW_TABLE_END].join('\n');
}
export function rowTableFaults(root: string, authoring: string): string[] {
  const start = authoring.indexOf(ROW_TABLE_BEGIN), end = authoring.indexOf(ROW_TABLE_END);
  return start >= 0 && end >= start && authoring.slice(start, end + ROW_TABLE_END.length) === checkRowTable(root) ? [] : ['consumer row table differs from producing code'];
}
if (import.meta.main) {
  const root = process.cwd(), path = join(root, 'docs/AUTHORING.md'), text = readFileSync(path, 'utf8');
  if (process.argv[2] === '--write') {
    const start = text.indexOf(ROW_TABLE_BEGIN), end = text.indexOf(ROW_TABLE_END);
    if (start < 0 || end < start) throw new Error('table markers are missing');
    writeFileSync(path, text.slice(0, start) + checkRowTable(root) + text.slice(end + ROW_TABLE_END.length));
  } else throw new Error('use --write to regenerate the producer table');
}
