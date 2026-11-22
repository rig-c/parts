/** Contributor identities and state sets, carried only while assembling a recorded run. */
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import type { PartSourceVisibility } from './parts.ts';
import { visitWarpSupport, type ScaleTranslate, type WarpFilter } from './raster/warp.ts';
import type { Raster } from './raster/types.ts';
import { VISIBILITY_STATE } from './visibility.ts';
import { SOURCE_STATE, sourceStateCounts } from './sourcestates.ts';

const UNRECORDED = 1 << VISIBILITY_STATE.unrecorded;
const VISIBLE = 1 << VISIBILITY_STATE.visible;
const OCCLUDED = 1 << VISIBILITY_STATE.occluded;
const PARTIAL_TOP = 1 << VISIBILITY_STATE.partialTop;
const DEPTH_TIE = 1 << VISIBILITY_STATE.depthTie;

interface Material { states: number; layers: readonly string[] }
interface Pixels { rgb: Uint32Array; alpha: Uint32Array }

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

  /**
   * Each texel's source state (#1473): `SOURCE_STATE.none` at alpha 8 or less,
   * otherwise the one state its material's contributors share — unrecorded
   * when any is outside the record, `mixed-source-states` when they differ.
   */
  states(image: Raster): { codes: Uint8Array; layers: string[] } {
    const pixels = this.images.get(image);
    const codes = new Uint8Array(image.width * image.height);
    const used = new Set<number>();
    for (let p = 0; p < codes.length; p++) {
      if (image.data[p * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
      const id = this.union(pixels?.rgb[p] ?? 0, pixels?.alpha[p] ?? 0);
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
