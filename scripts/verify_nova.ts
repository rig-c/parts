/**
 * Submit a selftest to the Nova pool with the caller's HEAD and partial-exit contract (issue #1327).
 *
 *     bun run verify:nova -- --label "<issue + purpose>" --owner "<who>" --session "<session id>" [--only <suites>]
 *
 * The pool uploads a snapshot without `.git`, so `validationHead()` in
 * `fixtures/validation_cache.ts` throws unless `RIG_PARTS_VALIDATION_HEAD` is
 * exported in the job. And `selftest.ts --only …` exits 2 when green, which the
 * pool runner records as `status: "failed"` (`exitCode: 2`) and folds to exit 1.
 *
 * This hand:
 *   1. reads `git rev-parse HEAD` in the caller's tree and refuses by name when
 *      HEAD cannot be determined or when the tracked tree is dirty;
 *   2. passes that SHA into the remote job as `RIG_PARTS_VALIDATION_HEAD`, with
 *      `RIG_PARTS_SELFTEST_JOBS=1` and optional `--only <suites>`;
 *   3. reads the inner selftest exit code (from the runner's `result.json` when
 *      `nova-run.sh` folded a non-zero exit to 1, or from the runner's exit
 *      status directly) and reports `green` (0 -> exit 0), `green-partial`
 *      (2 -> exit 0), `red` (1 -> exit 1) or `refused` (64 -> exit 64).
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const FIELDS = ['label', 'owner', 'session'] as const;
const HEAD_SHA = /^[a-f0-9]{40}$/;

export interface VerifyNovaArgs {
  label: string;
  owner: string;
  session: string;
  only?: string;
}

export type VerifyNovaStatus = 'green' | 'green-partial' | 'red' | 'refused';

export interface VerifyNovaVerdict {
  status: VerifyNovaStatus;
  exit: number;
}

export interface RunnerOutcome {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  stdout: string;
  stderr: string;
}

/** Parse `--label`, `--owner`, `--session` and optional `--only <suites>`, or return a named refusal. */
export function readVerifyNovaArgs(argv: readonly string[]): VerifyNovaArgs | string {
  const got: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const field = flag === '--only' ? 'only' : FIELDS.find((f) => flag === `--${f}`);
    if (field === undefined) {
      return `unknown argument ${JSON.stringify(flag)} — this takes --label, --owner, --session and optional --only <suites>`;
    }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) return `--${field} needs a value`;
    if (got[field] !== undefined) return `--${field} was given more than once`;
    const value = argv[++i];
    if (field === 'only' && value.trim() === '') return '--only needs a value';
    got[field] = value;
  }
  const missing = FIELDS.filter((f) => got[f] === undefined || got[f].trim() === '' || got[f].trim() === 'unknown');
  if (missing.length > 0) {
    return `${missing.map((f) => `--${f}`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing, blank or "unknown" — the pool records who sent each job, and refuses it without all three: --label "<issue + purpose>" --owner "<who>" --session "<session id>"`;
  }
  return {
    label: got.label,
    owner: got.owner,
    session: got.session,
    ...(got.only === undefined ? {} : { only: got.only }),
  };
}

/** Read `git rev-parse HEAD` and verify the tracked tree is clean, or return a named refusal. */
export function readVerifyNovaTree(cwd: string = process.cwd()): { head: string } | string {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  const head = git.stdout?.trim() ?? '';
  if (git.status !== 0 || !HEAD_SHA.test(head)) {
    const detail = (git.stderr?.trim() ?? '').split(/\r?\n/)[0] ?? '';
    return `no HEAD commit in ${cwd}${detail !== '' ? ` (${detail})` : ''} — run verify:nova from a git checkout with a commit so RIG_PARTS_VALIDATION_HEAD matches the upload`;
  }
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, encoding: 'utf8' });
  if (status.status !== 0) {
    return `cannot inspect tracked tree in ${cwd} (git status exited ${String(status.status)})`;
  }
  const dirty = (status.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (dirty.length > 0) {
    return `tracked tree is dirty at HEAD ${head} (${dirty.join(', ')}) — commit or stash tracked changes before submitting so the upload matches HEAD`;
  }
  return { head };
}

/** Build the remote command executed inside the uploaded snapshot root. */
export function verifyNovaRemote(head: string, only?: string): string {
  if (!HEAD_SHA.test(head)) {
    throw new Error(`verify:nova: invalid HEAD commit SHA ${JSON.stringify(head)}`);
  }
  const tail = only === undefined ? '' : ` -- --only '${only.replaceAll("'", "'\\''")}'`;
  return `RIG_PARTS_VALIDATION_HEAD=${head} RIG_PARTS_SELFTEST_JOBS=1 bun run selftest${tail}`;
}

/** The pool runner: `NOVA_RUN`, else `nova-run.sh` on `PATH`, else `null`. */
export function findNovaRunner(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NOVA_RUN !== undefined && env.NOVA_RUN !== '') return existsSync(env.NOVA_RUN) ? env.NOVA_RUN : null;
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir !== '' && existsSync(join(dir, 'nova-run.sh'))) return join(dir, 'nova-run.sh');
  }
  return null;
}

/** Map the inner selftest exit code (`0`, `2`, `1`, `64`) to its named verdict and hand exit code. */
export function verifyNovaVerdict(innerExit: number, combinedOutput = ''): VerifyNovaVerdict {
  if (innerExit === 0) return { status: 'green', exit: 0 };
  if (innerExit === 2 && !combinedOutput.includes('this run cannot account for itself')) {
    return { status: 'green-partial', exit: 0 };
  }
  if (innerExit === 64) return { status: 'refused', exit: 64 };
  return { status: 'red', exit: innerExit === 1 ? 1 : (innerExit || 1) };
}

/**
 * Resolve the inner command's exit code from a completed runner invocation.
 * `nova-run.sh` folds any non-zero remote exit code (`2`, `64`, `1`) to process
 * exit `1` and writes the inner exit code to `<evidence>/result.json`.
 */
export function resolveInnerExit(
  outcome: Pick<RunnerOutcome, 'status' | 'stderr'>,
): { innerExit: number; evidence: string | null } | string {
  if (outcome.status === null) return 'runner exited without a status code';
  const evidenceMatch = /^nova-run: exit \d+; evidence (.+)$/m.exec(outcome.stderr);
  if (evidenceMatch !== null) {
    const evidence = evidenceMatch[1].trim();
    const resultPath = join(evidence, 'result.json');
    if (!existsSync(resultPath)) {
      return `pool runner named evidence ${evidence}, but ${resultPath} is absent`;
    }
    try {
      const parsed = JSON.parse(readFileSync(resultPath, 'utf8')) as {
        status?: unknown;
        exitCode?: unknown;
        containmentError?: unknown;
        captureError?: unknown;
        evidenceError?: unknown;
      };
      if (parsed.containmentError || parsed.captureError || parsed.evidenceError) {
        return `pool runner containment/evidence error in ${resultPath}`;
      }
      if ((parsed.status === 'passed' || parsed.status === 'failed') && typeof parsed.exitCode === 'number') {
        return { innerExit: parsed.exitCode, evidence };
      }
      return `pool runner status in ${resultPath} is ${JSON.stringify(parsed.status)} (exitCode ${JSON.stringify(parsed.exitCode)})`;
    } catch (error) {
      return `cannot read ${resultPath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (/^nova-run:/m.test(outcome.stderr) && outcome.status !== 0) {
    return `pool runner aborted before job completion (exit ${outcome.status})`;
  }
  return { innerExit: outcome.status, evidence: null };
}

/** Spawn the pool runner, streaming stdout and stderr live while capturing them for verdict resolution. */
export function runVerifyNovaProcess(
  runner: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunnerOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (outcome: RunnerOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const child = spawn(runner, [...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      finish({ status: null, signal: null, error, stdout, stderr });
    });
    child.on('close', (status, signal) => {
      finish({ status, signal, stdout, stderr });
    });
  });
}

export function claudeMdV1Faults(claudeMd: string): string[] {
  const row = claudeMd.split(/\r?\n/).find((line) => line.startsWith('| V1 quick |'));
  if (row === undefined) return ['CLAUDE.md has no "| V1 quick |" row under Verification tiers'];
  if (!row.includes('`bun run verify:nova -- --only <suites>`')) {
    return [`CLAUDE.md V1 row does not name \`bun run verify:nova -- --only <suites>\`: ${row}`];
  }
  return [];
}

type Say = (name: string, ok: boolean, detail: string) => void;

/** Self-contained controls for `verify:nova`, run by the `tree` suite against a stub runner. */
export function runVerifyNovaChecks(root: string, say: Say): void {
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-verify-nova-'));
  const scriptPath = join(root, 'scripts', 'verify_nova.ts');
  const gitEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'verify-nova-test',
    GIT_AUTHOR_EMAIL: 'verify-nova-test@invalid',
    GIT_COMMITTER_NAME: 'verify-nova-test',
    GIT_COMMITTER_EMAIL: 'verify-nova-test@invalid',
  };
  try {
    const marker = join(work, 'runner.args');
    const bunCalls = join(work, 'bun.calls');
    const runner = join(work, 'stub-runner.sh');
    const fakeBin = join(work, 'bin');
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      join(fakeBin, 'bun'),
      '#!/bin/sh\n' +
        `printf 'HEAD=%s JOBS=%s ARGS=%s\\n' "\${RIG_PARTS_VALIDATION_HEAD:-}" "\${RIG_PARTS_SELFTEST_JOBS:-}" "$*" >> '${bunCalls}'\n` +
        'exit "${FAKE_BUN_EXIT:-0}"\n',
    );
    chmodSync(join(fakeBin, 'bun'), 0o755);
    writeFileSync(
      runner,
      '#!/bin/sh\n' +
        `printf '%s\\n' "$@" > '${marker}'\n` +
        'shift 6\n' +
        'if [ "$1" = "--" ]; then shift; fi\n' +
        'if [ -n "${STUB_REMOTE_CWD:-}" ]; then cd "$STUB_REMOTE_CWD" || exit 99; fi\n' +
        'if [ "${FAKE_NOVA_FOLD:-0}" = "1" ]; then\n' +
        '  "$@"\n' +
        '  rc=$?\n' +
        '  ev="${FAKE_NOVA_EVIDENCE:?}"\n' +
        '  mkdir -p "$ev"\n' +
        '  status="failed"\n' +
        '  if [ "$rc" = "0" ]; then status="passed"; fi\n' +
        '  printf \'{"id":"stub","status":"%s","exitCode":%d}\\n\' "$status" "$rc" > "$ev/result.json"\n' +
        '  if [ "$rc" != "0" ]; then\n' +
        '    echo "nova-run: no matching successful completion record" >&2\n' +
        '    echo "nova-run: exit 1; evidence $ev" >&2\n' +
        '    exit 1\n' +
        '  fi\n' +
        '  echo "nova-run: exit 0; evidence $ev" >&2\n' +
        '  exit 0\n' +
        'fi\n' +
        'exec "$@"\n',
    );
    chmodSync(runner, 0o755);

    const runHand = (
      cwd: string,
      args: readonly string[],
      extraEnv: NodeJS.ProcessEnv = {},
    ): { status: number | null; stdout: string; stderr: string; reached: string[] | null } => {
      rmSync(marker, { force: true });
      rmSync(bunCalls, { force: true });
      const r = spawnSync(process.execPath, [scriptPath, ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...gitEnv, NOVA_RUN: runner, ...extraEnv },
      });
      return {
        status: r.status,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        reached: existsSync(marker) ? readFileSync(marker, 'utf8').trimEnd().split('\n') : null,
      };
    };

    const baseArgs = ['--label', 'parts#1327 pool hand', '--owner', 'jinni', '--session', 'session-1327'];

    // 1. Refusal: no HEAD (directory outside git, and git init with no commit).
    const noGitDir = join(work, 'no-git');
    const emptyGitDir = join(work, 'empty-git');
    mkdirSync(noGitDir, { recursive: true });
    mkdirSync(emptyGitDir, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: emptyGitDir, env: gitEnv });
    const noGitRun = runHand(noGitDir, baseArgs);
    const emptyGitRun = runHand(emptyGitDir, baseArgs);
    say(
      'TY1327_01_NO_HEAD_IS_REFUSED_BEFORE_THE_RUNNER_STARTS',
      noGitRun.status === 2 &&
        noGitRun.reached === null &&
        noGitRun.stderr.includes('verify:nova: no HEAD commit') &&
        emptyGitRun.status === 2 &&
        emptyGitRun.reached === null &&
        emptyGitRun.stderr.includes('verify:nova: no HEAD commit'),
      `no-git: exit ${String(noGitRun.status)}, runner reached=${noGitRun.reached !== null}, stderr=${JSON.stringify(noGitRun.stderr.trim())}; empty-git: exit ${String(emptyGitRun.status)}, runner reached=${emptyGitRun.reached !== null}`,
    );

    // Prepare a clean git repo with one commit.
    const repo = join(work, 'repo');
    mkdirSync(repo, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: repo, env: gitEnv });
    writeFileSync(join(repo, 'tracked.txt'), 'clean\n');
    spawnSync('git', ['add', 'tracked.txt'], { cwd: repo, env: gitEnv });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo, env: gitEnv });
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', env: gitEnv }).stdout.trim();

    // 2. Refusal: dirty tracked tree (unstaged modification and staged addition).
    writeFileSync(join(repo, 'tracked.txt'), 'dirty\n');
    const dirtyUnstaged = runHand(repo, baseArgs);
    writeFileSync(join(repo, 'tracked.txt'), 'clean\n');
    writeFileSync(join(repo, 'staged.txt'), 'staged\n');
    spawnSync('git', ['add', 'staged.txt'], { cwd: repo, env: gitEnv });
    const dirtyStaged = runHand(repo, baseArgs);
    spawnSync('git', ['reset', '-q', 'HEAD', '--', 'staged.txt'], { cwd: repo, env: gitEnv });
    rmSync(join(repo, 'staged.txt'), { force: true });
    say(
      'TY1327_02_A_DIRTY_TRACKED_TREE_IS_REFUSED_BEFORE_THE_RUNNER_STARTS',
      HEAD_SHA.test(head) &&
        dirtyUnstaged.status === 2 &&
        dirtyUnstaged.reached === null &&
        dirtyUnstaged.stderr.includes(`verify:nova: tracked tree is dirty at HEAD ${head}`) &&
        dirtyUnstaged.stderr.includes('M tracked.txt') &&
        dirtyStaged.status === 2 &&
        dirtyStaged.reached === null &&
        dirtyStaged.stderr.includes(`verify:nova: tracked tree is dirty at HEAD ${head}`) &&
        dirtyStaged.stderr.includes('A  staged.txt'),
      `unstaged: exit ${String(dirtyUnstaged.status)}, reached=${dirtyUnstaged.reached !== null}, stderr=${JSON.stringify(dirtyUnstaged.stderr.trim())}; staged: exit ${String(dirtyStaged.status)}, reached=${dirtyStaged.reached !== null}`,
    );

    // 3. Refusal: missing, blank or "unknown" --label, --owner, --session, missing NOVA_RUN, and bad flags.
    const identityProbes: string[] = [];
    for (const field of FIELDS) {
      for (const [kind, args] of [
        ['absent', baseArgs.filter((_, k) => !(baseArgs[k] === `--${field}` || baseArgs[k - 1] === `--${field}`))],
        ['blank', baseArgs.map((a, k) => (baseArgs[k - 1] === `--${field}` ? '   ' : a))],
        ['unknown', baseArgs.map((a, k) => (baseArgs[k - 1] === `--${field}` ? 'unknown' : a))],
      ] as const) {
        const r = runHand(repo, args);
        if (r.status !== 2 || r.reached !== null || !r.stderr.startsWith(`verify:nova: --${field} is missing, blank or "unknown"`)) {
          identityProbes.push(`--${field} ${kind}: exit ${String(r.status)}, reached=${r.reached !== null}, stderr=${JSON.stringify(r.stderr.trim())}`);
        }
      }
    }
    const missingRunner = runHand(repo, baseArgs, { NOVA_RUN: join(work, 'missing-runner.sh') });
    const badFlag = runHand(repo, [...baseArgs, '--unknown-flag']);
    const emptyOnly = runHand(repo, [...baseArgs, '--only', '']);
    const twiceOnly = runHand(repo, [...baseArgs, '--only', 'tree', '--only', 'png']);
    say(
      'TY1327_03_MISSING_BLANK_OR_UNKNOWN_LABEL_OWNER_AND_SESSION_ARE_REFUSED_BY_NAME',
      identityProbes.length === 0 &&
        missingRunner.status === 2 &&
        missingRunner.reached === null &&
        missingRunner.stderr.includes('NOVA_RUN names') &&
        badFlag.status === 2 &&
        badFlag.reached === null &&
        badFlag.stderr.includes('unknown argument "--unknown-flag"') &&
        emptyOnly.status === 2 &&
        emptyOnly.reached === null &&
        emptyOnly.stderr.includes('--only needs a value') &&
        twiceOnly.status === 2 &&
        twiceOnly.reached === null &&
        twiceOnly.stderr.includes('--only was given more than once'),
      identityProbes.length === 0
        ? `9 label/owner/session controls refused before runner; missing NOVA_RUN, --unknown-flag, empty --only and duplicate --only refused`
        : identityProbes.join('; '),
    );

    // 4. Refusal: unknown --only suite name reaches selftest.ts and exits 64, reported as `refused`.
    const unknownSuite = runHand(repo, [...baseArgs, '--only', 'no-such-suite'], { STUB_REMOTE_CWD: root });
    const expectedUnknownRemote = verifyNovaRemote(head, 'no-such-suite');
    const expectedUnknownRunnerArgs = [...baseArgs, '--', 'bash', '-c', expectedUnknownRemote];
    say(
      'TY1327_04_UNKNOWN_ONLY_SUITE_REACHES_EXIT_64_AND_IS_REPORTED_REFUSED',
      unknownSuite.status === 64 &&
        unknownSuite.reached?.join('\n') === expectedUnknownRunnerArgs.join('\n') &&
        unknownSuite.stderr.includes('"no-such-suite", which is no suite of this run') &&
        unknownSuite.stderr.includes(`verify:nova: refused (inner exit 64, head ${head})`),
      `exit ${String(unknownSuite.status)}; stderr tail=${JSON.stringify(unknownSuite.stderr.trim().split('\n').slice(-2).join(' | '))}`,
    );

    // 5. Exit 2 -> green-partial (exit 0), Exit 1 -> red (exit 1), Exit 0 -> green (exit 0), against stub runner (both direct and folded).
    const fakePath = `${fakeBin}${delimiter}${process.env.PATH ?? ''}`;
    const partialDirect = runHand(repo, [...baseArgs, '--only', 'tree'], { PATH: fakePath, FAKE_BUN_EXIT: '2' });
    const partialCalls = existsSync(bunCalls) ? readFileSync(bunCalls, 'utf8').trim() : '';
    const evidenceDir = join(work, 'evidence-partial');
    const partialFolded = runHand(repo, [...baseArgs, '--only', 'tree'], {
      PATH: fakePath,
      FAKE_BUN_EXIT: '2',
      FAKE_NOVA_FOLD: '1',
      FAKE_NOVA_EVIDENCE: evidenceDir,
    });
    const redDirect = runHand(repo, [...baseArgs, '--only', 'tree'], { PATH: fakePath, FAKE_BUN_EXIT: '1' });
    const redFolded = runHand(repo, [...baseArgs, '--only', 'tree'], {
      PATH: fakePath,
      FAKE_BUN_EXIT: '1',
      FAKE_NOVA_FOLD: '1',
      FAKE_NOVA_EVIDENCE: join(work, 'evidence-red'),
    });
    const greenDirect = runHand(repo, baseArgs, { PATH: fakePath, FAKE_BUN_EXIT: '0' });
    const greenCalls = existsSync(bunCalls) ? readFileSync(bunCalls, 'utf8').trim() : '';
    say(
      'TY1327_05_EXIT_2_IS_REPORTED_GREEN_PARTIAL_EXIT_0_AND_EXIT_1_IS_REPORTED_RED_EXIT_1',
      partialDirect.status === 0 &&
        partialDirect.stdout.includes(`verify:nova: green-partial (inner exit 2, head ${head})`) &&
        partialCalls === `HEAD=${head} JOBS=1 ARGS=run selftest -- --only tree` &&
        partialFolded.status === 0 &&
        partialFolded.stdout.includes(`verify:nova: green-partial (inner exit 2, head ${head}, evidence ${evidenceDir})`) &&
        redDirect.status === 1 &&
        redDirect.stderr.includes(`verify:nova: red (inner exit 1, head ${head})`) &&
        redFolded.status === 1 &&
        redFolded.stderr.includes(`verify:nova: red (inner exit 1, head ${head}`) &&
        greenDirect.status === 0 &&
        greenDirect.stdout.includes(`verify:nova: green (inner exit 0, head ${head})`) &&
        greenCalls === `HEAD=${head} JOBS=1 ARGS=run selftest`,
      `partial direct: exit ${String(partialDirect.status)} (${partialCalls}); partial folded: exit ${String(partialFolded.status)}; red direct: exit ${String(redDirect.status)}; red folded: exit ${String(redFolded.status)}; green: exit ${String(greenDirect.status)}`,
    );

    // 6. CLAUDE.md V1 line and package.json script wiring.
    const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const v1Faults = claudeMdV1Faults(claudeMd);
    const plantedV1Faults = claudeMdV1Faults(
      claudeMd.replace('`bun run verify:nova -- --only <suites>`', '`bun run selftest -- --only <suites the diff touches>`'),
    );
    say(
      'TY1327_06_CLAUDE_MD_V1_ROW_AND_PACKAGE_JSON_NAME_VERIFY_NOVA',
      pkg.scripts?.['verify:nova'] === 'bun scripts/verify_nova.ts' &&
        v1Faults.length === 0 &&
        plantedV1Faults.length === 1,
      `package.json verify:nova=${JSON.stringify(pkg.scripts?.['verify:nova'])}; CLAUDE.md V1 faults=${v1Faults.length}; planted pre-#1327 V1 line -> ${plantedV1Faults.join('; ') || 'MISSED'}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const read = readVerifyNovaArgs(process.argv.slice(2));
  if (typeof read === 'string') {
    console.error(`verify:nova: ${read}`);
    process.exit(2);
  }
  const tree = readVerifyNovaTree();
  if (typeof tree === 'string') {
    console.error(`verify:nova: ${tree}`);
    process.exit(2);
  }
  const runner = findNovaRunner();
  if (runner === null) {
    const named = process.env.NOVA_RUN;
    console.error(
      named !== undefined && named !== ''
        ? `verify:nova: NOVA_RUN names ${named}, and nothing is there`
        : 'verify:nova: no pool runner — set NOVA_RUN to the path of nova-run.sh, or put nova-run.sh on PATH',
    );
    process.exit(2);
  }
  const remote = verifyNovaRemote(tree.head, read.only);
  const outcome = await runVerifyNovaProcess(runner, [
    '--label',
    read.label,
    '--owner',
    read.owner,
    '--session',
    read.session,
    '--',
    'bash',
    '-c',
    remote,
  ]);
  if (outcome.error !== undefined || outcome.status === null) {
    console.error(
      `verify:nova: could not run ${runner}: ${outcome.error?.message ?? (outcome.signal === null ? 'it left no exit status' : `it died by ${outcome.signal}`)}`,
    );
    process.exit(1);
  }
  const resolved = resolveInnerExit(outcome);
  if (typeof resolved === 'string') {
    console.error(`verify:nova: ${resolved}`);
    process.exit(outcome.status || 1);
  }
  const verdict = verifyNovaVerdict(resolved.innerExit, `${outcome.stdout}\n${outcome.stderr}`);
  const summary = `verify:nova: ${verdict.status} (inner exit ${resolved.innerExit}, head ${tree.head}${resolved.evidence !== null ? `, evidence ${resolved.evidence}` : ''})`;
  if (verdict.exit === 0) console.log(summary);
  else console.error(summary);
  process.exit(verdict.exit);
}
