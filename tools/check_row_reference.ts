/** Derive the consumer table from calls in the actual row producers. */
import ts from 'typescript';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CHECK_ROW_PATHS } from '../src/checkrow.ts';

export const ROW_TABLE_BEGIN = '<!-- check-row-table:begin -->';
export const ROW_TABLE_END = '<!-- check-row-table:end -->';
export function checkRowTable(root: string): string {
  const families = new Map<string, { scopes: Set<string>; kinds: Set<string>; subjects: Set<string>; sites: string[] }>(
    Object.keys(CHECK_ROW_PATHS).map(family => [family, { scopes: new Set(), kinds: new Set(), subjects: new Set(), sites: [] }]));
  const source = join(root, 'src');
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
  const program = ts.createProgram(files(source), { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  for (const path of files(source)) {
    const tree = program.getSourceFile(path);
    if (tree === undefined || path === join(source, 'checkrow.ts')) continue;
    const file = relative(source, path).replaceAll('\\', '/');
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        let symbol = checker.getSymbolAtLocation(node.expression);
        if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
        const producer = symbol?.declarations?.find(d => d.getSourceFile().fileName === join(source, 'checkrow.ts') && ts.isFunctionDeclaration(d));
        const name = producer !== undefined && ts.isFunctionDeclaration(producer) ? producer.name?.text : undefined;
        if (name === 'checkRow' || name === 'checkSlotRow') {
          const [family] = node.arguments;
          // A wrapper may forward a typed family. Coverage comes from the registry and output schema, not this inventory.
          if (family !== undefined && ts.isStringLiteral(family)) {
            const row = families.get(family.text);
            if (row === undefined) throw new Error(`${file}: unregistered row family ${family.text}`);
            const show = (n: ts.Node): string => n.getText(tree).replace(/\s+/g, ' ').replaceAll('|', '&#124;');
            const finding = node.arguments[name === 'checkSlotRow' ? 1 : 2];
            row.scopes.add(name === 'checkSlotRow' ? 'part when the supplied mapping resolves a piece; otherwise rig' : show(node.arguments[1]));
            row.kinds.add(finding.kind === ts.SyntaxKind.FalseKeyword ? 'evidence' : finding.kind === ts.SyntaxKind.TrueKeyword ? 'finding' : `finding when ${show(finding)}; otherwise evidence`);
            row.subjects.add(name === 'checkSlotRow' ? `resolved piece for ${show(node.arguments[2])}; otherwise []` : show(node.arguments[3]));
            const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
            row.sites.push(`[${file}:${line}](../src/${file}#L${line})`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return [ROW_TABLE_BEGIN, '| Row family | Registered JSON paths | row_scope | row_kind | row_subjects (producer expression) | Producer |',
    '| --- | --- | --- | --- | --- | --- |', ...[...families].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, row]) =>
      `| \`${name}\` | ${CHECK_ROW_PATHS[name as keyof typeof CHECK_ROW_PATHS].map(p => `\`${p}\``).join('; ')} | ${[...row.scopes].join('; ')} | ${[...row.kinds].join('; ')} | ${[...row.subjects].join('; ')} | ${row.sites.join(', ')} |`), '', '| Open serialized type path | Reason for schema exclusion |', '| --- | --- |', ...Object.entries(CHECK_ROW_TYPE_EXCLUSIONS).map(([path, reason]) => `| \`${path}\` | ${reason} |`), ROW_TABLE_END].join('\n');
}
export function rowTableFaults(root: string, authoring: string): string[] {
  const start = authoring.indexOf(ROW_TABLE_BEGIN), end = authoring.indexOf(ROW_TABLE_END);
  return start >= 0 && end >= start && authoring.slice(start, end + ROW_TABLE_END.length) === checkRowTable(root) ? [] : ['consumer row table differs from producing code'];
}


/** Legacy open figure dictionaries are deferred to the closed recursive output schema. */
export const CHECK_ROW_TYPE_EXCLUSIONS: Readonly<Record<string, string>> = {
  'BLINK_NO_HOLE.*': 'Open judgement figures; every emitted nested object row is schema checked.',
  'BREATH_VISIBLE.*': 'Open judgement figures; every emitted nested object row is schema checked.',
  'CHAIN_LAG.*': 'Open judgement figures; every emitted nested object row is schema checked.',
  'RECOMPOSITE_HOLES.*': 'Open reported figures; every emitted nested object row is schema checked.',
  'SETUP_POSE_VS_SOURCE.*': 'Open reported figures; every emitted nested object row is schema checked.',
  'STILL_REGIONS_DARK.*': 'Open judgement figures; every emitted nested object row is schema checked.',
  'STRESS_OFF_CHAIN.*': 'Open judgement figures; every emitted nested object row is schema checked.',
  'TEXTURE_STRETCH.*': 'Open judgement figures; every emitted nested object row is schema checked.',
  'TIP_OVER_ROOT.*': 'Open judgement figures; every emitted nested object row is schema checked.',
  'requirements.lines.*.*': 'Open requirement figures; the dictionary rows and nested object arrays are schema checked.',
  'sets.*.RECOMPOSITE_HOLES.*': 'Open alternate reported figures; every emitted nested object row is schema checked.',
};

/** Read the serialized public type, independently of calls and runtime fixtures. */
export function checkRowTypeInventory(root: string, plant = ''): { arrays: string[]; unknown: string[]; faults: string[] } {
  const path = join(root, 'src/check.ts');
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, allowImportingTsExtensions: true };
  const host = ts.createCompilerHost(options), originalRead = host.readFile;
  host.readFile = file => {
    const source = originalRead(file);
    return file === path && source !== undefined ? source + plant : source;
  };
  const program = ts.createProgram([path], options, host), checker = program.getTypeChecker();
  const source = program.getSourceFile(path);
  const declaration = source?.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'CheckFigures');
  if (declaration === undefined) return { arrays: [], unknown: [], faults: ['serialized CheckFigures type is absent'] };
  const arrays = new Set<string>(), unknown = new Set<string>();
  const objectType = (type: ts.Type): boolean => type.isUnionOrIntersection() ? type.types.some(objectType) : Boolean(type.flags & ts.TypeFlags.Object) && !checker.isArrayType(type) && !checker.isTupleType(type);
  const walk = (type: ts.Type, at: string, ancestors: readonly ts.Type[]): void => {
    if (ancestors.includes(type)) return;
    const parents = [...ancestors, type];
    if (type.isUnionOrIntersection()) { type.types.forEach(t => walk(t, at, parents)); return; }
    if (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) { unknown.add(at); return; }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (element === undefined) return;
      if (objectType(element)) arrays.add(at);
      walk(element, at + '[]', parents);
      return;
    }
    if (!(type.flags & ts.TypeFlags.Object)) return;
    const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    if (index !== undefined) walk(index, at + '.*', parents);
    for (const property of checker.getPropertiesOfType(type)) {
      const site = property.valueDeclaration ?? property.declarations?.[0];
      if (site !== undefined) walk(checker.getTypeOfSymbolAtLocation(property, site), at === '' ? property.name : at + '.' + property.name, parents);
    }
  };
  walk(checker.getTypeAtLocation(declaration), '', []);
  const matches = (pattern: string, path: string): boolean => {
    const p = pattern.split('.'), a = path.split('.');
    return p.length === a.length && p.every((v, i) => v === '*' || v === a[i]);
  };
  const registered = Object.values(CHECK_ROW_PATHS).flat();
  const faults = [...[...arrays].filter(path => !registered.some(p => matches(p, path))).map(path => `${path}: object-array type has no registered family`),
    ...[...unknown].filter(path => !(path in CHECK_ROW_TYPE_EXCLUSIONS)).map(path => `${path}: unknown output type has no documented schema exclusion`)];
  return { arrays: [...arrays].sort(), unknown: [...unknown].sort(), faults };
}

if (import.meta.main) {
  const root = process.cwd(), path = join(root, 'docs/AUTHORING.md'), text = readFileSync(path, 'utf8');
  if (process.argv[2] === '--write') {
    const start = text.indexOf(ROW_TABLE_BEGIN), end = text.indexOf(ROW_TABLE_END);
    if (start < 0 || end < start) throw new Error('table markers are missing');
    writeFileSync(path, text.slice(0, start) + checkRowTable(root) + text.slice(end + ROW_TABLE_END.length));
  } else throw new Error('use --write to regenerate the producer table');
}
