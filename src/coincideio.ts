/** Actual textured setup observations for the report-only support instrument. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { figureSilhouette, paintedFigure, sourceInRig } from './assemble.ts';
import { officialRenderer, type CheckInputs } from './check.ts';
import { supportReport, type SupportDomain, type SupportPart, type SupportReport } from './coincide.ts';
import { newRaster, type Mask } from './raster/types.ts';

/** Domains, when available, must already be registered to this native setup
 * grid. Legacy output supplies none, which leaves every pair unavailable. */
export function observeSupport(build: string, input: CheckInputs, domains: readonly SupportDomain[] = []): SupportReport {
  const width = input.stage.width, height = input.stage.height;
  const empty = (reason: string): SupportReport => ({
    ...supportReport(width, height, [], [], null), reason,
    unowned: { status: 'unavailable', reason, area_px: null, regions: [] },
  });
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return empty('native setup stage requires positive integer dimensions');
  const api = officialRenderer(), skeleton = join(build, 'skeleton.json'), atlas = join(build, 'skeleton.atlas');
  const candidate = api.loadCandidate({ skeletonText: readFileSync(skeleton, 'utf8'), atlasText: readFileSync(atlas, 'utf8'), atlasDir: build, label: 'part support report' }, { skeleton, atlas }, undefined);
  const pose = api.throughPoser(candidate.choice, p => api.sampleSetupPose(p, { geometry: true, texture: true })).value[0];
  if (pose === undefined || pose.pieces.some(p => 'source' in p)) return empty('actual setup textured pieces are unavailable or clipped');
  const viewport = { minX: input.stage.x, minY: input.stage.y, maxX: input.stage.x + width, maxY: input.stage.y + height, scale: 1, width, height };
  const project = api.projector(viewport), parts: SupportPart[] = [];
  for (const piece of pose.pieces) {
    const mask: Mask = { width, height, data: new Uint8Array(width * height) };
    api.rasterisePiece(api.pageFor(candidate.pages, piece), piece, project, viewport, (x, y, _r, _g, _b, a) => { if (a >= 128) mask.data[y * width + x] = 1; });
    // A slot can draw several pieces. Keep one union at its actual draw order.
    const previous = parts.find(p => p.name === piece.slot);
    if (previous === undefined) parts.push({ name: piece.slot, mask });
    else for (let p = 0; p < mask.data.length; p++) previous.mask.data[p] |= mask.data[p];
  }
  let figure: Mask | null = null;
  if (input.source !== null) {
    const source = input.source.painting, white = newRaster(source.width, source.height);
    for (let p = 0; p < source.width * source.height; p++) {
      const alpha = source.data[p * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) white.data[p * 4 + c] = Math.round(source.data[p * 4 + c] * alpha + 255 * (1 - alpha));
      white.data[p * 4 + 3] = 255;
    }
    const painting = sourceInRig(white, width, height), silhouette = figureSilhouette(painting), painted = paintedFigure(painting);
    for (let p = 0; p < painted.length; p++) silhouette.data[p] &= painted[p];
    figure = silhouette;
  }
  return supportReport(width, height, parts, domains, figure);
}
