import ts from 'typescript';

/** Literal reporter declarations in selftest.ts, grouped by registered suite.
 * This supplements the selected live tally; imported helpers and computed IDs
 * remain the full CI tally's responsibility. No suite is executed here.
 */
export function sourceCaseNames(source: string, suites: ReadonlyArray<readonly [string, string]>): Map<string, string[]> {
  const file = ts.createSourceFile('selftest.ts', source, ts.ScriptTarget.Latest, true);
  const functions = new Map(file.statements.filter(ts.isFunctionDeclaration).flatMap(d => d.name === undefined ? [] : [[d.name.text, d] as const]));
  const result = new Map<string, string[]>();
  for (const [key, name] of suites) {
    const first = functions.get(name);
    if (first === undefined) throw new Error(`PRE_PREFIX_SOURCE: suite ${key} names no function ${name}`);
    const visited = new Set<ts.Node>();
    const names = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (visited.has(node)) return;
      visited.add(node);
      if (ts.isCallExpression(node)) {
        if (/\b(?:say|quietSay|reportCase|check|report)\b/.test(node.expression.getText(file)) && node.arguments.length >= 2) {
          const arg = node.arguments[0];
          const text = ts.isStringLiteralLike(arg) ? arg.text : ts.isTemplateExpression(arg) ? arg.head.text : '';
          // Existing error-only fallback: it can only print FAIL, when the
          // harness returned no result. It is not a successful case owner.
          const errorOnly = key === 'comfy' && text === 'CF00_THE_HARNESS_RAN' && node.arguments[1].kind === ts.SyntaxKind.FalseKeyword;
          if (/^[A-Z]+\d+_/.test(text) && !errorOnly) names.add(text);
        }
        const refs = [node.expression, ...node.arguments];
        for (const ref of refs) if (ts.isIdentifier(ref)) {
          const helper = functions.get(ref.text);
          if (helper !== undefined) visit(helper);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(first);
    // This existing suite dispatches its stages in child processes by string.
    if (key === 'assemble-examples') {
      const stage = functions.get('runAssembleExampleStage');
      if (stage === undefined) throw new Error('PRE_PREFIX_SOURCE: assemble stage is absent');
      visit(stage);
    }
    result.set(key, [...names]);
  }
  return result;
}
