/** Hand-counted native sample controls for issue #1082. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { headCropPreflight, headCropPreflightLines } from '../src/headcroppreflight.ts';
import { readWrapperLayers } from '../src/layers.ts';
import { writeRun, C } from './assemble_fixture.ts';

export function runHeadCropPreflightChecks(dir: string, say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const fullDir = join(dir, 'full');
  writeRun(fullDir, [{ name: 'back hair', depth: 0.5, rects: [{ x0: 0, y0: 0, x1: 8, y1: 8, colour: C }] }], 8);
  const full = readWrapperLayers(fullDir);
  const report = (box: [number, number, number, number], w = 8, h = 8) => headCropPreflight(full, { w, h }, box);
  const counts = (r: ReturnType<typeof report>) => { const l = r.layers[0]; return [l.drawn_px, l.sides.top_px, l.sides.left_px, l.sides.right_px, l.bottom_px].join(','); };
  const integer = report([2, 2, 6, 6]);
  say('PR1082_INTEGER_EVERY_EDGE', counts(integer) === '64,16,16,16,16', counts(integer), '8x8 block: two outside rows/columns per edge; corners belong to both');
  const fractional = report([2.5, 2.5, 5.5, 5.5]);
  say('PR1082_FRACTIONAL_CENTRES', counts(fractional) === '64,16,16,24,24' && counts(report([2.51, 2.51, 5.51, 5.51])) === '64,24,24,16,16', counts(fractional), 'centres equal to near edges are inside; equal to far edges outside; moving each edge .01 flips one row/column');
  const registered = report([5, 1, 11, 7], 16, 8);
  say('PR1082_SCALE_AND_PAD', counts(registered) === '64,16,16,24,24' && registered.registration.scale_source_per_run === 2 && registered.registration.pad_top === 4, JSON.stringify(registered.registration), 'scale 2 gives centres 1,3,...15; painting y subtracts pad 4');
  full.layers[0].pixels.data[3] = 8;
  const cut = report([2, 2, 6, 6]);
  full.layers[0].pixels.data[3] = 9;
  say('PR1082_ORIGINAL_ALPHA', counts(cut) === '63,15,15,16,16' && counts(report([2, 2, 6, 6])) === '64,16,16,16,16', counts(cut), 'alpha 8 excluded, alpha 9 included; original samples are not ghost-cleaned');
  const inside = report([0, 0, 8, 8]);
  const bottom = report([0, 0, 8, 6]);
  say('PR1082_NO_HIT_AND_BOTTOM_ONLY', counts(inside) === '64,0,0,0,0' && headCropPreflightLines(inside).length === 0 && counts(bottom) === '64,0,0,0,16' && headCropPreflightLines(bottom).length === 1, counts(bottom), 'zero rows retained in JSON; bottom advice remains separate');
  const child = spawnSync(process.execPath, ['cli.ts', 'head-crop-preflight', '--full', fullDir, '--canvas', '8x8', '--head-box', '[2.5,2.5,5.5,5.5]'], { encoding: 'utf8' });
  say('PR1082_CLI_REPORT_ONLY', child.status === 0 && child.stdout === JSON.stringify(fractional) + '\n' && child.stderr === headCropPreflightLines(fractional).join('\n') + '\n', `exit ${child.status}; stdout ${child.stdout.trim()}; stderr ${child.stderr.trim()}`, 'clipping exits zero with parseable JSON and exactly one hit-tag line; no head run/config required');
  for (const [label, invoke, code] of [
    ['BOX', () => report([2, 2, 1, 1]), 'HEAD_CROP_PREFLIGHT_BOX'],
    ['CANVAS', () => report([0, 0, 8, 8], 0, 8), 'HEADBOX_CANVAS_SIZE'],
    ['RUN', () => headCropPreflight({ ...full, canvas: { w: 8, h: 7 } }, { w: 8, h: 8 }, [0, 0, 8, 8]), 'HEADBOX_RUN_SQUARE'],
  ] as const) {
    let detail = '';
    try { invoke(); } catch (err) { detail = String(err); }
    say(`PR1082_MALFORMED_${label}`, detail.includes(code), detail, 'malformed geometry is distinct from valid clipping, which never refuses');
  }
}
