/**
 * rig-c 3.5.0 `build` writes `run.json` (`rigc-run/1`) beside the artifact, with
 * the run's `started_at` and `finished_at`. Two builds of the same inputs differ
 * only there, so a byte-identity control blanks those two values in a rigc run
 * stamp and compares every other byte. Nothing else is normalised, and no other
 * file is touched.
 */
export function blankRigcRunClock(bytes: Buffer, file: string): Buffer {
  if (!(file === 'run.json' || file.endsWith('/run.json'))) return bytes;
  const text = bytes.toString('utf8');
  if (!text.includes('"spec": "rigc-run/1"')) return bytes;
  return Buffer.from(text.replace(/"(started_at|finished_at)": "[^"]*"/g, '"$1": "<clock>"'), 'utf8');
}
