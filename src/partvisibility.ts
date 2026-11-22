/** Contributor identities and state sets, carried only while assembling a recorded run. */
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import type { PartSourceOverlap, PartSourceVisibility } from './parts.ts';
import { visitWarpSupport, type ScaleTranslate, type WarpFilter } from './raster/warp.ts';
import type { Raster } from './raster/types.ts';
import { VISIBILITY_STATE } from './visibility.ts';
import { SOURCE_STATE, sourceStateCounts } from './sourcestates.ts';

const UNRECORDED = 1 << VISIBILITY_STATE.unrecorded;
const VISIBLE = 1 << VISIBILITY_STATE.visible;
const OCCLUDED = 1 << VISIBILITY_STATE.occluded;
const PARTIAL_TOP = 1 << VISIBILITY_STATE.partialTop;
const DEPTH_TIE = 1 << VISIBILITY_STATE.depthTie;
const decided = (states: number): boolean => states === VISIBLE || states === OCCLUDED;

interface Material { states: number; layers: readonly string[] }
interface Box { x0: number; y0: number; x1: number; y1: number }
interface NativeSource extends Box { states: Uint8Array }
interface Registration {
  map: ScaleTranslate;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  area: number;
  xs: Uint32Array;
  ys: Uint32Array;
  sources: NativeSource[];
}
interface DirectPixels { registration: Registration; refs: Uint32Array }
interface Pixels {
  rgb: Uint32Array;
  alpha: Uint32Array;
  origin?: Box;
  direct?: DirectPixels;
}
type NativeSamples = NonNullable<PartSourceOverlap['native_samples']>;

/** Boundaries of the native integer sample origins in each half-open rig cell. */
function cellStarts(sourceSize: number, size: number, scale: number, translate: number): Uint32Array {
  const starts = new Uint32Array(size + 1);
  let sample = 0;
  for (let boundary = 0; boundary <= size; boundary++) {
    while (sample < sourceSize && scale * sample + translate < boundary) sample++;
    starts[boundary] = sample;
  }
  return starts;
}

function rgba(image: Raster, p: number): number {
  const i = p * 4, d = image.data;
  return d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24);
}

function countNative(counts: NativeSamples, back: DirectPixels, b: number, front: DirectPixels, f: number, x: number, y: number): void {
  const { width, height, area, sources, xs, ys } = back.registration;
  const br = back.refs[b] - 1, fr = front.refs[f] - 1;
  if (br < 0 || fr < 0 || x < 0 || y < 0 || x >= width || y >= height) return;
  const p = y * width + x;
  if (br % area !== p || fr % area !== p) return;
  const rear = sources[Math.floor(br / area)], ahead = sources[Math.floor(fr / area)];
  // Each native coordinate belongs to one rig cell, so scanning each accepted
  // cell once also deduplicates physical coordinates within this part pair.
  const x0 = Math.max(xs[x], rear.x0, ahead.x0), x1 = Math.min(xs[x + 1], rear.x1, ahead.x1);
  const y0 = Math.max(ys[y], rear.y0, ahead.y0), y1 = Math.min(ys[y + 1], rear.y1, ahead.y1);
  for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
    const rs = rear.states[(sy - rear.y0) * (rear.x1 - rear.x0) + sx - rear.x0];
    const fs = ahead.states[(sy - ahead.y0) * (ahead.x1 - ahead.x0) + sx - ahead.x0];
    if (rs === 0 || fs === 0) continue;
    counts.overlap_px++;
    if (rs === VISIBLE && fs === OCCLUDED) counts.inverted_px++;
  }
}

/** A placed part in draw order: its rig-space box and its output image. */
export interface PlacedImage { name: string; x: number; y: number; image: Raster }

/** ID zero denotes material outside the record, with no known layer. */
export class PartVisibility {
  private readonly materials: Material[] = [{ states: UNRECORDED, layers: [] }];
  private readonly ids = new Map([[JSON.stringify([UNRECORDED, []]), 0]]);
  private readonly combinations = new Map<number, Map<number, number>>();
  private readonly images = new WeakMap<Raster, Pixels>();
  private readonly registrations = new WeakMap<object, Registration>();
  private readonly directSamples = new WeakMap<readonly [number, number], { registration: Registration; ref: number; rgba: number }>();

  private id(states: number, layers: readonly string[]): number {
    const key = JSON.stringify([states, layers]);
    const previous = this.ids.get(key);
    if (previous !== undefined) return previous;
    const id = this.materials.length;
    this.materials.push({ states, layers });
    this.ids.set(key, id);
    return id;
  }

  union(a: number, b: number): number {
    if (a === b) return a;
    const first = Math.min(a, b), second = Math.max(a, b);
    let row = this.combinations.get(first);
    if (row === undefined) this.combinations.set(first, row = new Map());
    const previous = row.get(second);
    if (previous !== undefined) return previous;
    const am = this.materials[a], bm = this.materials[b];
    const combined = this.id(am.states | bm.states, [...new Set([...am.layers, ...bm.layers])].sort());
    row.set(second, combined);
    return combined;
  }

  private plane(image: Raster): Pixels {
    let pixels = this.images.get(image);
    if (pixels === undefined) {
      const size = image.width * image.height;
      pixels = { rgb: new Uint32Array(size), alpha: new Uint32Array(size) };
      this.images.set(image, pixels);
    }
    return pixels;
  }

  layer(image: Raster, name: string, states?: Uint8Array): void {
    const pixels = this.plane(image);
    this.forgetNative(image);
    if (states?.length === pixels.alpha.length) pixels.origin = { x0: 0, y0: 0, x1: image.width, y1: image.height };
    const ids = Object.values(VISIBILITY_STATE).map(state => this.id(1 << state, [name]));
    if (states === undefined) {
      pixels.rgb.fill(ids[0]);
      pixels.alpha.fill(ids[0]);
    } else for (let p = 0; p < states.length; p++) {
      pixels.rgb[p] = pixels.alpha[p] = ids[states[p]];
    }
  }

  clone(from: Raster, to: Raster): void {
    const source = this.images.get(from);
    if (source === undefined) return;
    const target: Pixels = { rgb: source.rgb.slice(), alpha: source.alpha.slice() };
    if (from.width === to.width && from.height === to.height) {
      if (source.origin !== undefined) target.origin = source.origin;
      const direct = source.direct;
      if (direct !== undefined) target.direct = { registration: direct.registration, refs: direct.refs.slice() };
    }
    this.images.set(to, target);
  }

  /** Drop native evidence for edits that leave the existing material tally intact. */
  forgetNative(image: Raster, p?: number): void {
    const target = this.images.get(image);
    if (target === undefined) return;
    delete target.origin;
    if (p === undefined) delete target.direct;
    else if (target.direct !== undefined) target.direct.refs[p] = 0;
  }

  private directPlane(image: Raster, target: Pixels, registration: Registration): DirectPixels {
    return target.direct ??= { registration, refs: new Uint32Array(image.width * image.height) };
  }

  private writeDirect(image: Raster, target: Pixels, p: number, registration?: Registration, ref = 0): void {
    delete target.origin;
    if (registration !== undefined && ref !== 0) this.directPlane(image, target, registration);
    if (target.direct !== undefined) target.direct.refs[p] = target.direct.registration === registration ? ref : 0;
  }

  copy(to: Raster, p: number, from: Raster, q = p, channels: 'both' | 'rgb' | 'alpha' = 'both'): void {
    const source = this.images.get(from);
    const target = this.plane(to);
    if (channels !== 'alpha') target.rgb[p] = source?.rgb[q] ?? 0;
    if (channels !== 'rgb') target.alpha[p] = source?.alpha[q] ?? 0;
    const direct = channels === 'both' ? source?.direct : undefined;
    this.writeDirect(to, target, p, direct?.registration, direct?.refs[q]);
  }

  rows(to: Raster, from: Raster, x: number, y: number, width: number, height: number, dx = 0, dy = 0): void {
    const source = this.images.get(from);
    const fresh = !this.images.has(to);
    if (source === undefined) {
      const target = this.images.get(to);
      if (target !== undefined) {
        delete target.origin;
        for (let row = 0; row < height; row++) {
          const at = (row + dy) * to.width + dx;
          target.direct?.refs.fill(0, at, at + width);
        }
      }
      return;
    }
    const target = this.plane(to);
    const origin = source.origin;
    delete target.origin;
    if (fresh && origin !== undefined) {
      const box = {
        x0: Math.max(x, origin.x0) - x + dx, y0: Math.max(y, origin.y0) - y + dy,
        x1: Math.min(x + width, origin.x1) - x + dx, y1: Math.min(y + height, origin.y1) - y + dy,
      };
      if (box.x1 > box.x0 && box.y1 > box.y0) target.origin = box;
    }
    const direct = source.direct;
    if (direct !== undefined) this.directPlane(to, target, direct.registration);
    const dest = target.direct;
    for (let row = 0; row < height; row++) {
      const start = (row + y) * from.width + x;
      const at = (row + dy) * to.width + dx;
      target.rgb.set(source.rgb.subarray(start, start + width), at);
      target.alpha.set(source.alpha.subarray(start, start + width), at);
      if (dest === undefined) continue;
      if (direct?.registration === dest.registration) dest.refs.set(direct.refs.subarray(start, start + width), at);
      else dest.refs.fill(0, at, at + width);
    }
  }

  sample(image: Raster, p: number): readonly [number, number] {
    const pixels = this.images.get(image);
    const sample = [pixels?.rgb[p] ?? 0, pixels?.alpha[p] ?? 0] as const;
    const direct = pixels?.direct, ref = direct?.refs[p] ?? 0;
    if (direct !== undefined && ref !== 0) this.directSamples.set(sample, { registration: direct.registration, ref, rgba: rgba(image, p) });
    return sample;
  }

  write(image: Raster, p: number, material: readonly [number, number]): void {
    const pixels = this.plane(image);
    pixels.rgb[p] = material[0];
    pixels.alpha[p] = material[1];
    const direct = this.directSamples.get(material);
    if (direct !== undefined && direct.rgba === rgba(image, p)) this.writeDirect(image, pixels, p, direct.registration, direct.ref);
    else this.forgetNative(image, p);
  }

  painting(to: Raster, p: number, channels: 'both' | 'rgb', blend = false): void {
    const target = this.images.get(to);
    if (target === undefined) return;
    target.rgb[p] = blend ? this.union(target.rgb[p], 0) : 0;
    if (channels === 'both') target.alpha[p] = 0;
    this.forgetNative(to, p);
  }

  underfill(to: Raster, p: number, head: Raster, full: Raster, headAlpha: number, fullAlpha: number): void {
    const h = this.images.get(head), f = this.images.get(full), target = this.plane(to);
    const hr = h?.rgb[p] ?? 0, fr = f?.rgb[p] ?? 0;
    const fullColor = fullAlpha > 0 || fr !== 0;
    target.rgb[p] = headAlpha === 255 || !fullColor ? hr : headAlpha === 0 ? fr : this.union(hr, fr);
    const ha = h?.alpha[p] ?? 0, fa = f?.alpha[p] ?? 0;
    target.alpha[p] = headAlpha === 255 || headAlpha > fullAlpha ? ha : fullAlpha > headAlpha ? fa : this.union(ha, fa);
    this.forgetNative(to, p);
  }

  private nativeWarp(from: Raster, to: Raster, source: Pixels, target: Pixels, map: ScaleTranslate, fullFrame: object): void {
    const box = source.origin;
    if (box === undefined || map.sx <= 0 || map.sy <= 0 || (map.sx === 1 && map.sy === 1)) return;
    let registration = this.registrations.get(fullFrame);
    if (registration === undefined) {
      registration = {
        map, sourceWidth: from.width, sourceHeight: from.height, width: to.width, height: to.height, area: to.width * to.height,
        xs: cellStarts(from.width, to.width, map.sx, map.tx), ys: cellStarts(from.height, to.height, map.sy, map.ty), sources: [],
      };
      this.registrations.set(fullFrame, registration);
    }
    const { sourceWidth, sourceHeight, width, height, area, sources } = registration;
    const m = registration.map;
    if (sourceWidth !== from.width || sourceHeight !== from.height || width !== to.width || height !== to.height ||
        m.sx !== map.sx || m.sy !== map.sy || m.tx !== map.tx || m.ty !== map.ty) return;
    // Zero is untracked. Each other code identifies one source plane and the
    // raw rig pixel, even after that pixel is cropped or copied elsewhere.
    const base = sources.length * area + 1;
    if (base + area - 1 > 0xffffffff) return;
    const stride = box.x1 - box.x0;
    const states = new Uint8Array(stride * (box.y1 - box.y0));
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
      const p = y * sourceWidth + x;
      if (from.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
        states[(y - box.y0) * stride + x - box.x0] = this.materials[source.alpha[p]].states;
      }
    }
    sources.push({ ...box, states });
    const { refs } = this.directPlane(to, target, registration);
    for (let p = 0; p < area; p++) if (to.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) refs[p] = base + p;
  }

  warp(from: Raster, to: Raster, map: ScaleTranslate, filter: WarpFilter, hasColor?: (pixel: number) => boolean, fullFrame?: object): void {
    const source = this.images.get(from);
    this.forgetNative(to);
    if (source === undefined) return;
    const target = this.plane(to);
    visitWarpSupport(from, map, to.width, to.height, filter, (p, taps) => {
      if (to.data[p * 4 + 3] === 0 && hasColor?.(p) !== true) return;
      let rgb: number | undefined;
      let alpha: number | undefined;
      for (const q of taps) {
        if (from.data[q * 4 + 3] === 0) continue;
        const a = source.alpha[q];
        const premultiplied = this.union(source.rgb[q], a);
        rgb = rgb === undefined ? premultiplied : this.union(rgb, premultiplied);
        alpha = alpha === undefined ? a : this.union(alpha, a);
      }
      target.rgb[p] = rgb ?? 0;
      target.alpha[p] = alpha ?? 0;
    });
    if (fullFrame !== undefined) this.nativeWarp(from, to, source, target, map, fullFrame);
  }

  /** The material of an output pixel: the union of its colour and alpha contributors. */
  private material(image: Raster, p: number): number {
    const pixels = this.images.get(image);
    return this.union(pixels?.rgb[p] ?? 0, pixels?.alpha[p] ?? 0);
  }

  /**
   * Issue #1474: for each part, every later part (drawn in front of it) whose
   * opaque output pixels (alpha above 8, as `opaque_px`) meet its own. A pixel
   * is inverted when every contributor of the part drawn behind is visible in
   * the record and every contributor of the part drawn in front is occluded:
   * the painting shows the back part there and the draw order shows the front.
   */
  overlaps(parts: readonly PlacedImage[]): PartSourceOverlap[][] {
    return parts.map((back, i) => parts.slice(i + 1).flatMap((front): PartSourceOverlap[] => {
      const x0 = Math.max(back.x, front.x), y0 = Math.max(back.y, front.y);
      const x1 = Math.min(back.x + back.image.width, front.x + front.image.width);
      const y1 = Math.min(back.y + back.image.height, front.y + front.image.height);
      const row: PartSourceOverlap = {
        front: front.name, source_layers: [], overlap_px: 0, inverted_px: 0, agreeing_px: 0, unordered_px: 0,
        undecided_px: { 'partial-top': 0, 'depth-tie': 0, 'mixed-source-states': 0 }, unrecorded_px: 0,
      };
      const layers = new Set<string>();
      const bd = this.images.get(back.image)?.direct, fd = this.images.get(front.image)?.direct;
      const native = bd !== undefined && fd !== undefined && bd.registration === fd.registration
        ? { back: bd, front: fd, counts: { overlap_px: 0, inverted_px: 0 } } : undefined;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const b = (y - back.y) * back.image.width + x - back.x;
        const f = (y - front.y) * front.image.width + x - front.x;
        if (back.image.data[b * 4 + 3] <= OPAQUE_ALPHA_ABOVE || front.image.data[f * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
        row.overlap_px++;
        if (native !== undefined) countNative(native.counts, native.back, b, native.front, f, x, y);
        const bm = this.materials[this.material(back.image, b)], fm = this.materials[this.material(front.image, f)];
        const bs = bm.states, fs = fm.states;
        if (((bs | fs) & UNRECORDED) !== 0) row.unrecorded_px++;
        else if (bs === VISIBLE && fs === OCCLUDED) {
          row.inverted_px++;
          for (const layer of [...bm.layers, ...fm.layers]) layers.add(layer);
        } else if (bs === OCCLUDED && fs === VISIBLE) row.agreeing_px++;
        else if (decided(bs) && decided(fs)) row.unordered_px++;
        else if (bs === PARTIAL_TOP && fs === PARTIAL_TOP) row.undecided_px['partial-top']++;
        else if (bs === DEPTH_TIE && fs === DEPTH_TIE) row.undecided_px['depth-tie']++;
        else row.undecided_px['mixed-source-states']++;
      }
      row.source_layers = [...layers].sort();
      if (native !== undefined && native.counts.overlap_px > 0) row.native_samples = native.counts;
      return row.overlap_px === 0 ? [] : [row];
    }));
  }

  /**
   * Each texel's source state (#1473): `SOURCE_STATE.none` at alpha 8 or less,
   * otherwise the one state its material's contributors share — unrecorded
   * when any is outside the record, `mixed-source-states` when they differ.
   */
  states(image: Raster): { codes: Uint8Array; layers: string[] } {
    const codes = new Uint8Array(image.width * image.height);
    const used = new Set<number>();
    for (let p = 0; p < codes.length; p++) {
      if (image.data[p * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
      const id = this.material(image, p);
      used.add(id);
      const { states } = this.materials[id];
      codes[p] = (states & UNRECORDED) !== 0 ? SOURCE_STATE.unrecorded
        : states === VISIBLE ? SOURCE_STATE.visible
        : states === OCCLUDED ? SOURCE_STATE.occluded
        : states === PARTIAL_TOP ? SOURCE_STATE['partial-top']
        : states === DEPTH_TIE ? SOURCE_STATE['depth-tie']
        : SOURCE_STATE['mixed-source-states'];
    }
    const layers = new Set<string>();
    for (const id of used) for (const layer of this.materials[id].layers) layers.add(layer);
    return { codes, layers: [...layers].sort() };
  }

  /** The counts are read off {@link states}, so the map assemble writes beside them holds them exactly. */
  summarize(image: Raster): PartSourceVisibility {
    const { codes, layers } = this.states(image);
    return { source_layers: layers, ...sourceStateCounts(codes) };
  }
}
