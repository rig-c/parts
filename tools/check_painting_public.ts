/** Public visible-assembly rest-error membership regression gate (#1141). */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import refusals from '../fixtures/painting_edge_refusals.json';
import followup from '../fixtures/painting_edge_followup1141.json';
import expected from '../fixtures/painting_edge_public.json';
import { assembleStage } from '../src/build.ts';
import type { AssembleResult } from '../src/assemble.ts';
import { checkExampleInputs, pinnedExamplesCommit } from '../scripts/example_inputs.ts';

export interface PublicPaintingReading {
  grid: number[];
  /** Native rig pixel indices, sorted, whose max-channel rest error exceeds 40. */
  errors: number[];
}

/** Both sides own their keys; an added or lost example or pixel is named. */
export function publicPaintingFaults(example: string, actual: PublicPaintingReading, wanted: PublicPaintingReading): string[] {
  const faults: string[] = [];
  if (JSON.stringify(actual.grid) !== JSON.stringify(wanted.grid)) faults.push(`PAINTING_PUBLIC_GRID: ${example} found ${actual.grid}, required ${wanted.grid}`);
  const found = new Set(actual.errors), required = new Set(wanted.errors);
  const coordinate = (p: number): string => `${p % wanted.grid[0]},${Math.floor(p / wanted.grid[0])}`;
  for (const p of found) if (!required.has(p)) faults.push(`PAINTING_PUBLIC_ERROR_ADDED: ${example} (${coordinate(p)})`);
  for (const p of required) if (!found.has(p)) faults.push(`PAINTING_PUBLIC_ERROR_LOST: ${example} (${coordinate(p)})`);
  return faults;
}

type CoordinateLists = Record<string, ReadonlyArray<{ x: number; y: number }>>;

export function publicPaintingListFaults(readings: Record<string, PublicPaintingReading>,
  refusalRows: CoordinateLists = refusals, followupRows: CoordinateLists = followup): string[] {
  const faults: string[] = [];
  for (const [label, list] of [['refusals', refusalRows], ['followup', followupRows]] as const) {
    for (const example of Object.keys(readings)) if (list[example] === undefined) {
      faults.push(`PAINTING_PUBLIC_LIST_KEY_LOST: ${label}/${example} is absent`);
    }
    for (const [example, rows] of Object.entries(list)) {
      const reading = readings[example];
      if (reading === undefined) { faults.push(`PAINTING_PUBLIC_LIST_KEY: ${label}/${example} has no measured example`); continue; }
      const errors = new Set(reading.errors);
      for (const row of rows) if (!errors.has(row.y * reading.grid[0] + row.x)) {
        faults.push(`PAINTING_PUBLIC_LIST_ROW: ${label}/${example} (${row.x},${row.y}) is absent from measured rest errors`);
      }
    }
  }
  return faults;
}

export function publicPaintingErrors(result: AssembleResult): number[] {
  const pixels: number[] = [];
  for (let p = 0; p < result.recomposite.width * result.recomposite.height; p++) {
    if ([0, 1, 2].some(c => Math.abs(result.recomposite.data[p * 4 + c] - result.paintingInRig.data[p * 4 + c]) > 40)) pixels.push(p);
  }
  return pixels;
}

/** Phase-1 inputs: visible + near-white, including the example declaring silhouette.
 * Each CI invocation assembles one pinned example in a fresh process. */
export function measurePublicPainting(example: string): PublicPaintingReading {
  const root = join('examples', example), inputs = join(root, 'inputs');
  const pin = pinnedExamplesCommit(readFileSync('scripts/fetch-examples.sh', 'utf8'));
  const problems = checkExampleInputs(inputs, example, pin);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const directory = mkdtempSync(join(tmpdir(), 'painting-public-'));
  try {
    const result = assembleStage({ source: join(inputs, 'painting.png'), full: join(inputs, 'layers/full'),
      head: join(inputs, 'layers/head'), config: join(root, 'config.json'), project: 'visible', seam: 'near-white' }, {
      partsJson: join(directory, 'rig/parts.json'), partsDir: join(directory, 'rig/parts'),
      recomposite: join(directory, 'render/recomposite_rig.png'), errorMap: join(directory, 'render/recomposite_error_rig.png'),
    }, () => {});
    return { grid: [...result.parts.rig_size], errors: publicPaintingErrors(result) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const [example, ...extra] = process.argv.slice(2);
  const wanted: Record<string, PublicPaintingReading> = expected;
  if (extra.length !== 0 || wanted[example] === undefined) throw new Error('PAINTING_PUBLIC_EXAMPLE: expected one of ' + Object.keys(wanted).join(', '));
  const start = performance.now();
  const actual = measurePublicPainting(example);
  console.log(`PAINTING_PUBLIC_WALL[${example}]: ${Math.round(performance.now() - start)} ms`);
  const faults = publicPaintingFaults(example, actual, wanted[example]);
  // Validate both list key sets on every invocation, including keys only in B.
  faults.push(...publicPaintingListFaults({ ...wanted, [example]: actual }));
  if (faults.length > 0) throw new Error(faults.join('\n'));
  console.log(`PASS PAINTING_PUBLIC_MEMBERSHIP[${example}]: ${actual.errors.length} exact rest-error coordinates`);
}
