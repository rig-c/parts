/** Hand-written clock stamps: both path spellings are exercised on every host. */
import { blankRigcRunClock } from './rigc_run_clock.ts';

type Say = (name: string, ok: boolean, detail: string) => void;

export function runRigcRunClockChecks(say: Say): void {
  // Deliberate CI gate plant; this branch must never merge.
  say('BU1277_PLANTED_FAILURE', false, 'deliberate failing control for the three-host CI gate proof; never merge');
  const stamp = Buffer.from('{\n  "spec": "rigc-run/1",\n  "started_at": "2026-01-01T00:00:00.000Z",\n  "finished_at": "2026-01-01T00:00:01.000Z",\n  "outputs": ["skeleton.json"]\n}');
  const expected = Buffer.from('{\n  "spec": "rigc-run/1",\n  "started_at": "<clock>",\n  "finished_at": "<clock>",\n  "outputs": ["skeleton.json"]\n}');
  const paths = ['run.json', 'check/build/run.json', 'check\\build\\run.json'];
  say('BU1277_RUN_CLOCK_PATHS', paths.every(path => blankRigcRunClock(stamp, path).equals(expected)),
    'bare, forward-slash and backslash run.json paths blank only the two clock values');
  const otherSpec = Buffer.from(stamp.toString().replace('rigc-run/1', 'other-run/1'));
  const changedOutput = Buffer.from(stamp.toString().replace('skeleton.json', 'changed.json'));
  const otherFiles = ['not-run.json', 'check/build/not-run.json', 'check\\build\\not-run.json', 'run.json/child', 'run.json\\child'];
  say('BU1277_RUN_CLOCK_PRESERVES_OTHER_BYTES',
    paths.every(path => blankRigcRunClock(otherSpec, path).equals(otherSpec) &&
      !blankRigcRunClock(changedOutput, path).equals(expected)) &&
    otherFiles.every(path => blankRigcRunClock(stamp, path).equals(stamp)),
    'wrong spec and other filenames remain byte-identical; a changed output still differs under both separators');
}
