/**
 * The one error shape every stage refuses with.
 *
 * An agent that cannot see the image reads these and nothing else, so a
 * problem carries three things the reader can act on without guessing: the
 * CODE it can grep for, the OBJECT it concerns (a layer, a config field, a
 * file), and a sentence naming the value found and the value required. A
 * refusal that says only "invalid" is not a refusal this repository writes.
 *
 * A reader collects every problem it can find before it throws, so one run
 * names every missing field rather than one per attempt.
 */
export interface Problem {
  /** Upper-snake name of the rule that refused, e.g. `LAYERS_PNG_PRESENT`. */
  code: string;
  /** The thing refused, spelled the way the input spells it: `layer "face"`, `config.bones[3].parent`. */
  object: string;
  /** What was found and what was required. */
  detail: string;
}

export function problemLine(p: Problem): string {
  return `${p.code}: ${p.object} — ${p.detail}`;
}

/**
 * The end of every FAIL line: the command that prints the guide's row for its
 * rule (issue #343). This is the one place that writes it, so every line has the
 * same form, and rig-c's lines have the same form with its own command. A line
 * that quotes a rigc failure keeps rigc's pointer inside the quote, and this one
 * goes after it.
 */
export function guidePointer(code: string): string {
  return ` (see rig-parts guide ${code})`;
}

/**
 * Complete only a bare relayed core compile refusal (issue #356). Current core
 * names a guide rule; older callers may name the compile section or a child.
 * Keep those pointers and all non-compile lines verbatim. The parts rule's
 * outer pointer remains failLine's responsibility.
 */
export function coreCompileGuideLine(line: string): string {
  if (!/^\s*rigc compile error\b/.test(line) || /\(see rigc guide (?:§5\.1(?:\.\d+)*|[A-Z][A-Z0-9_]*)\)/.test(line)) return line;
  const body = line.trimEnd();
  return `${body} (see rigc guide §5.1)${line.slice(body.length)}`;
}

/** A refusal as it is printed: `  FAIL  RULE: object — detail (see rig-parts guide RULE)`. */
export function failLine(p: Problem): string {
  return `  FAIL  ${problemLine(p)}${guidePointer(p.code)}`;
}

export class PartsError extends Error {
  readonly problems: readonly Problem[];

  constructor(problems: readonly Problem[]) {
    super(problems.map(problemLine).join('\n'));
    this.name = 'PartsError';
    this.problems = problems;
  }
}

/** Throw once, with every problem, if there are any. */
export function refuseIfAny(problems: readonly Problem[]): void {
  if (problems.length > 0) throw new PartsError(problems);
}
