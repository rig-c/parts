/** Pre-rig pair domains and actual textured setup observations (#998). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { figureSilhouette, paintedFigure, sourceInRig } from './assemble.ts';
import { officialRenderer, sourceSizeProblem, type CheckInputs } from './check.ts';
import { supportReport, unownedSupport, SUPPORT_GRID_CODE, type SupportPart, type SupportReport } from './coincide.ts';
import { refuseIfAny } from './errors.ts';
import { readPng } from './raster/png.ts';
import { newRaster, type Mask } from './raster/types.ts';
import { readSupportDomains } from './supportdomains.ts';

/** The setup candidate is already built by check. Only alpha callbacks are
 * sampled here; no additional rigc build/render or renderFrame is run. */
export function observeSupport(build: string, input: CheckInputs, supportSource?: string): SupportReport {
  const width = input.stage.width, height = input.stage.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
    (input.parts !== null && (input.parts.rig_size[0] !== width || input.parts.rig_size[1] !== height))) refuseIfAny([{ code: SUPPORT_GRID_CODE, object: 'support native canvas', detail: `stage ${width}x${height} must match the positive integer parts.json grid ${JSON.stringify(input.parts?.rig_size)}` }]);
  const ordered = input.parts === null ? [] : [...input.parts.parts];
  const slots = new Map((Array.isArray(input.rig.slots) ? input.rig.slots : []).flatMap((s, i) =>
    typeof s === 'object' && s !== null && 'name' in s && typeof s.name === 'string' ? [[s.name, i] as const] : []));
  for (const part of ordered) if (!slots.has(part.name)) refuseIfAny([{ code: 'CHECK_PART_SLOT_PRESENT', object: `part "${part.name}"`, detail: 'support report requires the named setup slot; no draw order is guessed' }]);
  ordered.sort((a, b) => slots.get(a.name)! - slots.get(b.name)!);
  const art = ordered.map<SupportPart>(part => {
    const image = readPng(join(input.partsDir, `${part.name}.png`));
    if (image.width !== part.w || image.height !== part.h) refuseIfAny([{ code: SUPPORT_GRID_CODE, object: `part "${part.name}"`, detail: `PNG is ${image.width}x${image.height}; parts.json requires ${part.w}x${part.h}` }]);
    const mask: Mask = { width, height, data: new Uint8Array(width * height) };
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const u = part.x + x, v = part.y + y;
      if (u >= 0 && v >= 0 && u < width && v < height && image.data[(y * image.width + x) * 4 + 3] >= 128) mask.data[v * width + u] = 1;
    }
    return { name: part.name, mask };
  });
  const domains = input.parts === null ? [] : readSupportDomains(input.partsPath, input.partsDir, input.parts);
  const report = supportReport(width, height, art, domains, null);
  report.pair_registration = 'pre-rig parts.json placements, setup slot order';
  report.unowned_registration = 'official renderer setup, native stage grid';
  const api = officialRenderer(), skeleton = join(build, 'skeleton.json'), atlas = join(build, 'skeleton.atlas');
  const candidate = api.loadCandidate({ skeletonText: readFileSync(skeleton, 'utf8'), atlasText: readFileSync(atlas, 'utf8'), atlasDir: build, label: 'part support report' }, { skeleton, atlas }, undefined);
  const pose = api.throughPoser(candidate.choice, p => api.sampleSetupPose(p, { geometry: true, texture: true })).value[0];
  if (pose === undefined || pose.pieces.some(p => 'source' in p)) {
    report.unowned.reason = 'actual setup textured pieces are unavailable or clipped';
    return report;
  }
  const viewport = { minX: input.stage.x, minY: input.stage.y, maxX: input.stage.x + width, maxY: input.stage.y + height, scale: 1, width, height };
  const project = api.projector(viewport), union: Mask = { width, height, data: new Uint8Array(width * height) };
  for (const piece of pose.pieces) api.rasterisePiece(api.pageFor(candidate.pages, piece), piece, project, viewport,
    (x, y, _r, _g, _b, a) => { if (a >= 128) union.data[y * width + x] = 1; });
  const source = input.source?.painting ?? (supportSource === undefined ? null : readPng(supportSource));
  let figure: Mask | null = null;
  if (source !== null) {
    const mismatch = sourceSizeProblem(source.width, source.height, input.stage, input.parts?.scale_rig_per_source ?? null);
    if (mismatch !== null) refuseIfAny([{ code: SUPPORT_GRID_CODE, object: 'support painting', detail: mismatch }]);
    const white = newRaster(source.width, source.height);
    for (let p = 0; p < source.width * source.height; p++) {
      const alpha = source.data[p * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) white.data[p * 4 + c] = Math.round(source.data[p * 4 + c] * alpha + 255 * (1 - alpha));
      white.data[p * 4 + 3] = 255;
    }
    const painting = sourceInRig(white, width, height), silhouette = figureSilhouette(painting), painted = paintedFigure(painting);
    for (let p = 0; p < painted.length; p++) silhouette.data[p] &= painted[p];
    figure = silhouette;
  }
  report.unowned = unownedSupport(width, height, [{ name: 'setup union', mask: union }], figure);
  report.status = report.pairs.some(p => (p.boundary_length_px ?? 0) > 0) || (report.unowned.area_px ?? 0) > 0 ? 'WARN' : 'REPORTED';
  return report;
}
