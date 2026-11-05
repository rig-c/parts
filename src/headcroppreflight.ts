/** Read-only crop advice on the original full-run drawn-pixel grid (issue #1082). */
import { squarePad } from './inputs.ts';
import { OPAQUE_ALPHA_ABOVE, type LayerSet } from './layers.ts';
import type { Box } from './headbox.ts';
import { refuseIfAny, type Problem } from './errors.ts';

export const HEAD_CROP_PREFLIGHT_LINE = 'HEAD_CROP_PREFLIGHT';

/** Counts are native full-run samples, never resampled area; corners count on both edges. */
export function headCropPreflight(full: LayerSet, source: { w: number; h: number }, box: Box) {
  const problems: Problem[] = [];
  if (![source.w, source.h].every(n => Number.isInteger(n) && n > 0)) problems.push({ code: 'HEADBOX_CANVAS_SIZE', object: '--canvas', detail: `painting is ${source.w}x${source.h}; positive integer dimensions required` });
  if (full.canvas.w !== full.canvas.h || !Number.isInteger(full.canvas.w) || full.canvas.w <= 0) problems.push({ code: 'HEADBOX_RUN_SQUARE', object: full.source, detail: `full run is ${full.canvas.w}x${full.canvas.h}; a positive square canvas is required` });
  if (box.length !== 4 || !box.every(Number.isFinite) || !(box[0] < box[2] && box[1] < box[3])) problems.push({ code: 'HEAD_CROP_PREFLIGHT_BOX', object: '--head-box', detail: `head_box ${JSON.stringify(box)}; four finite coordinates with left < right and top < bottom required` });
  refuseIfAny(problems);
  const pad = squarePad(source.w, source.h);
  const scale = pad.side / full.canvas.w;
  const layers = full.layers.map(layer => {
    let drawn_px = 0, top_px = 0, left_px = 0, right_px = 0, bottom_px = 0;
    for (let y = 0; y < layer.pixels.height; y++) for (let x = 0; x < layer.pixels.width; x++) {
      if (layer.pixels.data[(y * layer.pixels.width + x) * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
      drawn_px++;
      const cx = (layer.left + x + 0.5) * scale - pad.left;
      const cy = (layer.top + y + 0.5) * scale - pad.top;
      if (cx < box[0]) left_px++;
      if (cx >= box[2]) right_px++;
      if (cy < box[1]) top_px++;
      if (cy >= box[3]) bottom_px++;
    }
    return { tag: layer.name, drawn_px, sides: { top_px, left_px, right_px }, bottom_px };
  });
  return { spec: 'rig-parts/head-crop-preflight/1', head_box: box, source_canvas: source, run_canvas: full.canvas,
    drawn_alpha_above: OPAQUE_ALPHA_ABOVE, pixel_grid: 'full-run', registration: { scale_source_per_run: scale, pad_left: pad.left, pad_top: pad.top }, layers };
}

/** One advice line per hit tag; bottom remains distinct from the three side/top edges. */
export function headCropPreflightLines(report: ReturnType<typeof headCropPreflight>): string[] {
  return report.layers.filter(r => r.sides.top_px + r.sides.left_px + r.sides.right_px + r.bottom_px > 0).map(r =>
    `${HEAD_CROP_PREFLIGHT_LINE}: tag ${JSON.stringify(r.tag)} — top ${r.sides.top_px}, left ${r.sides.left_px}, right ${r.sides.right_px} drawn px; bottom ${r.bottom_px} drawn px (extend_below_crop); report only`);
}
