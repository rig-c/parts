/** Analytic short-hem and attribution controls for the report-only instrument. */
import { alphaComposite } from '../src/raster/composite.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { edgePairResiduals, type ResidualPart } from '../src/edgeresidual.ts';
import { paintingEdges } from '../src/paintingedges.ts';
import { ERROR_LIMIT } from '../src/assemble.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const W = 24, H = 9;
const RED = [200, 0, 0], BLUE = [0, 0, 200];
function layer(colour: readonly number[], covers: (x: number) => number): Raster {
  const image = newRaster(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) image.data.set([...colour, covers(x)], (y * W + x) * 4);
  return image;
}
function composite(parts: readonly ResidualPart[]): Raster {
  let image = newRaster(W, H);
  image.data.fill(255);
  for (const part of parts) image = alphaComposite(image, part.image, part.x, part.y);
  return image;
}
const part = (name: string, image: Raster): ResidualPart => ({ name, image, x: 0, y: 0 });
export function runEdgeResidualChecks(say: Say): void {
  const painting = layer(BLUE, () => 255);
  for (let y = 0; y < H; y++) for (let x = 0; x < 10; x++) painting.data.set([...RED, 255], (y * W + x) * 4);
  for (const [short, id, expected] of [[0, 'ED9544', 0], [2, 'ED9545', 0], [6, 'ED9546', 54]] as const) {
    const back = layer(BLUE, () => 255), front = layer(RED, x => x < 10 - short ? 255 : 0);
    paintingEdges([back, front], painting, { painted: new Uint8Array(W * H).fill(1), editable: [true, true] });
    const parts = [part('back', back), part('front', front)];
    const rendered = composite(parts);
    const frozen = parts.map(p => new Uint8ClampedArray(p.image.data)), source = new Uint8ClampedArray(painting.data), final = new Uint8ClampedArray(rendered.data);
    const report = edgePairResiduals(parts, painting, rendered, ERROR_LIMIT);
    const row = report.pairs[0];
    const expectedSpans = Array.from({ length: H }, (_, y) => [y, 4, 10]);
    say(id + '_POST_PASS_SHORT_HEM_' + short,
      row.status === 'measured' && row.residual_px === expected && row.back_pixels.count === expected && (short === 6 ? JSON.stringify(row.box) === '[4,0,6,9]' && JSON.stringify(row.back_pixels.spans) === JSON.stringify(expectedSpans) : row.box === null && row.back_pixels.spans.length === 0),
      JSON.stringify(row));
    const again = edgePairResiduals(parts, painting, rendered, ERROR_LIMIT);
    say('ED9547_REPORT_IS_DETERMINISTIC_AND_READ_ONLY_' + short,
      JSON.stringify(again) === JSON.stringify(report) && parts.every((p, i) => p.image.data.every((v, j) => v === frozen[i][j])) && painting.data.every((v, j) => v === source[j]) && rendered.data.every((v, j) => v === final[j]),
      'report repeat preserves every part, painting and final composite byte');
  }
  const side = edgePairResiduals([part('back', layer(BLUE, x => x >= 10 ? 255 : 0)), part('front', layer(RED, x => x < 10 ? 255 : 0))], painting, painting, ERROR_LIMIT);
  say('ED9548_SIDE_TOUCH_IS_EXPLICITLY_SKIPPED', side.pairs[0].status === 'skip' && side.pairs[0].skipped.includes('no alpha overlap above the existing owner floor'), JSON.stringify(side.pairs[0]));
  const hiddenParts = [part('back', layer(BLUE, () => 255)), part('front', layer(RED, () => 255))];
  const hidden = edgePairResiduals(hiddenParts, painting, composite(hiddenParts), ERROR_LIMIT);
  say('ED9549_OCCLUDED_OBSERVATION_IS_UNAVAILABLE', hidden.pairs[0].status === 'unavailable' && hidden.pairs[0].residual_px === null && hidden.pairs[0].unavailable.includes('back has no visible pixel observation'), JSON.stringify(hidden.pairs[0]));
  const ambiguousParts = [part('back', layer(BLUE, () => 255)), part('left', layer(RED, x => x < 4 ? 255 : 0)), part('right', layer(BLUE, x => x >= 10 ? 255 : 0))];
  const ambiguous = edgePairResiduals(ambiguousParts, painting, composite(ambiguousParts), ERROR_LIMIT);
  say('ED9550_MULTIPLE_FRONT_ATTRIBUTION_IS_UNAVAILABLE', ambiguous.pairs.filter(p => p.back === 'back').every(p => p.status === 'unavailable' && p.residual_px === null && p.unavailable_px === 54) && ambiguous.summary.unassigned_error_px === 54, JSON.stringify(ambiguous.summary));
  const mixedParts = [part('back', layer(BLUE, () => 255)), part('front', layer(RED, x => x < 4 ? 255 : 0)), part('veil', layer(BLUE, x => x >= 4 && x < 10 ? 64 : 0))];
  const mixed = edgePairResiduals(mixedParts, painting, composite(mixedParts), ERROR_LIMIT);
  const row = mixed.pairs.find(p => p.front === 'front' && p.back === 'back')!;
  say('ED9551_ADDITIONAL_ALPHA_CONTRIBUTION_IS_UNAVAILABLE', row.status === 'unavailable' && row.residual_px === null && row.unavailable.some(s => s.includes('partial-alpha')), JSON.stringify(row));
}
