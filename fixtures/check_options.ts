/** Test-only CLI policy: measurements of existing bars do not need extremes renders. */
export function selftestCliArgs(args: readonly string[], keepDefaultExtremes = false): string[] {
  const flag = args[0] === 'check' ? '--rig' : args[0] === 'build' ? '--config' : null;
  const index = flag === null ? -1 : args.indexOf(flag);
  const input = index < 0 ? undefined : args[index + 1];
  const measures = input !== undefined && !input.startsWith('--');
  return measures && !keepDefaultExtremes && !args.includes('--no-extremes') ? [args[0], '--no-extremes', ...args.slice(1)] : [...args];
}
