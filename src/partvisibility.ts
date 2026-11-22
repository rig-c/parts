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
interface Pixels { rgb: Uint32Array; alpha: Uint32Array }
/** A placed part in draw order: its rig-space box and its output image. */
export interface PlacedImage { name: string; x: number; y: number; image: Raster }

/** ID zero denotes material outside the record, with no known layer. */
export class PartVisibility {
  private readonly materials: Material[] = [{ states: UNRECORDED, layers: [] }];
  private readonly ids = new Map([[JSON.stringify([UNRECORDED, []]), 0]]);
  private readonly combinations = new Map<number, Map<number, number>>();
  private readonly images = new WeakMap<Raster, Pixels>();

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
    if (source !== undefined) this.images.set(to, { rgb: source.rgb.slice(), alpha: source.alpha.slice() });
  }

  copy(to: Raster, p: number, from: Raster, q = p, channels: 'both' | 'rgb' | 'alpha' = 'both'): void {
    const source = this.images.get(from);
    const target = this.plane(to);
    if (channels !== 'alpha') target.rgb[p] = source?.rgb[q] ?? 0;
    if (channels !== 'rgb') target.alpha[p] = source?.alpha[q] ?? 0;
  }

  rows(to: Raster, from: Raster, x: number, y: number, width: number, height: number, dx = 0, dy = 0): void {
    const source = this.images.get(from);
    if (source === undefined) return;
    const target = this.plane(to);
    for (let row = 0; row < height; row++) {
      const start = (row + y) * from.width + x;
      const at = (row + dy) * to.width + dx;
      target.rgb.set(source.rgb.subarray(start, start + width), at);
      target.alpha.set(source.alpha.subarray(start, start + width), at);
    }
  }

  sample(image: Raster, p: number): readonly [number, number] {
    const pixels = this.images.get(image);
    return [pixels?.rgb[p] ?? 0, pixels?.alpha[p] ?? 0];
  }

  write(image: Raster, p: number, material: readonly [number, number]): void {
    const pixels = this.plane(image);
    pixels.rgb[p] = material[0];
    pixels.alpha[p] = material[1];
  }

  painting(to: Raster, p: number, channels: 'both' | 'rgb', blend = false): void {
    const target = this.images.get(to);
    if (target === undefined) return;
    target.rgb[p] = blend ? this.union(target.rgb[p], 0) : 0;
    if (channels === 'both') target.alpha[p] = 0;
  }

  underfill(to: Raster, p: number, head: Raster, full: Raster, headAlpha: number, fullAlpha: number): void {
    const h = this.images.get(head), f = this.images.get(full), target = this.plane(to);
    const hr = h?.rgb[p] ?? 0, fr = f?.rgb[p] ?? 0;
    const fullColor = fullAlpha > 0 || fr !== 0;
    target.rgb[p] = headAlpha === 255 || !fullColor ? hr : headAlpha === 0 ? fr : this.union(hr, fr);
    const ha = h?.alpha[p] ?? 0, fa = f?.alpha[p] ?? 0;
    target.alpha[p] = headAlpha === 255 || headAlpha > fullAlpha ? ha : fullAlpha > headAlpha ? fa : this.union(ha, fa);
  }

  warp(from: Raster, to: Raster, map: ScaleTranslate, filter: WarpFilter, hasColor?: (pixel: number) => boolean): void {
    const source = this.images.get(from);
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
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const b = (y - back.y) * back.image.width + x - back.x;
        const f = (y - front.y) * front.image.width + x - front.x;
        if (back.image.data[b * 4 + 3] <= OPAQUE_ALPHA_ABOVE || front.image.data[f * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
        row.overlap_px++;
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
