import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import partsPackage from '../package.json' with { type: 'json' };
import { processRigcRunner } from '../tools/build-process.ts';
import { findRigc, rigcRanClause } from './check.ts';
import { PartsError } from './errors.ts';
import { type ApplyMeshEditActInput, prepareMeshEditAct, type RemeshResult, remeshStage } from './remesh.ts';

export type { ApplyMeshEditActInput, RemeshResult } from './remesh.ts';

/** Apply one finalized mesh edit to a Parts rig, or return its bound revision on an exact replay. */
export function applyMeshEditAct(input: ApplyMeshEditActInput): RemeshResult {
  const prepared = prepareMeshEditAct(input);
  if ('provenance' in prepared) return prepared;

  const root = fileURLToPath(new URL('..', import.meta.url));
  const bin = findRigc(root, process.env.PATH ?? '');
  const runner = processRigcRunner(bin);
  const version = runner(['--version']);
  const rigc = version.status === 0 ? version.out.trim().split('\n')[0] : '';
  if (rigc === '') {
    throw new PartsError([{ code: 'REMESH_RIGC_GREEN', object: 'rigc --version',
      detail: `exited ${version.status}${rigcRanClause(version)}; the provenance names the rigc that gated the revision, so its version is required` }]);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-remesh-'));
  try {
    return remeshStage(prepared.input, runner, bin, { parts: partsPackage.version, rigc }, scratch, () => {}, {}, prepared);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
