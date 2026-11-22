/** Issue #1480. Preload for the recorded, core-projection scarf assemble.
 * RIG_PARTS_VISIBILITY_COVERAGE=<new report.json> bun --preload ./tools/read_visibility_coverage.ts cli.ts assemble ...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPAQUE_ALPHA_ABOVE } from '../src/layers.ts';
import { PartVisibility, type PlacedImage } from '../src/partvisibility.ts';
import { readParts } from '../src/parts.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { SOURCE_STATE } from '../src/sourcestates.ts';
import { ALPHA_FLOOR, VISIBILITY_STATE } from '../src/visibility.ts';

const CAUSES = [
  'full_alpha_1_8', 'full_alpha_9_127', 'full_without_mask',
  'head_alpha_1_8', 'head_alpha_9_127', 'head_alpha_128_255',
  'painting_rgb', 'painting_rgba', 'residual',
] as const;
type Cause = typeof CAUSES[number];
const BOUNDS = {
  painting: ['painting_rgb', 'painting_rgba'],
  full_floor_9: ['full_alpha_9_127'],
  head_floor_128: ['head_alpha_128_255'],
  head_floor_128_full_floor_9: ['head_alpha_128_255', 'full_alpha_9_127'],
  painting_head_floor_128_full_floor_9: ['painting_rgb', 'painting_rgba', 'head_alpha_128_255', 'full_alpha_9_127'],
} as const satisfies Record<string, readonly Cause[]>;

function marker(shadow: PartVisibility, name: string, state = VISIBILITY_STATE.unrecorded as number): number {
  const image = newRaster(1, 1);
  shadow.layer(image, name, Uint8Array.of(state));
  return shadow.sample(image, 0)[0];
}

/** Shadow IDs carry only diagnostic labels. An implicit zero in a channel is
 * unknown material and must survive a union with a known cause. */
class Coverage extends PartVisibility {
  private readonly residual = marker(this, 'residual');
  private readonly recorded = marker(this, 'recorded', VISIBILITY_STATE.visible);
  private readonly causes = CAUSES.map(cause => cause === 'residual' ? this.residual : marker(this, cause));

  override union(a: number, b: number): number {
    return super.union(a || this.residual, b || this.residual);
  }

  private mark(cause: Cause): number { return this.causes[CAUSES.indexOf(cause)]; }

  native(image: Raster, name: string, states?: Uint8Array): void {
    for (let p = 0; p < image.width * image.height; p++) {
      const alpha = image.data[p * 4 + 3];
      if (alpha === 0) continue;
      let id = this.residual;
      if (states !== undefined) {
        if (states[p] !== VISIBILITY_STATE.unrecorded) id = this.recorded;
        else if (alpha < ALPHA_FLOOR) id = this.mark(alpha <= OPAQUE_ALPHA_ABOVE ? 'full_alpha_1_8' : 'full_alpha_9_127');
      } else if (name.startsWith('head:')) {
        id = this.mark(alpha >= ALPHA_FLOOR ? 'head_alpha_128_255' : alpha <= OPAQUE_ALPHA_ABOVE ? 'head_alpha_1_8' : 'head_alpha_9_127');
      } else if (name.startsWith('full:')) id = this.mark('full_without_mask');
      this.write(image, p, [id, id]);
    }
  }

  override painting(to: Raster, p: number, channels: 'both' | 'rgb', blend = false): void {
    const [rgb, alpha] = this.sample(to, p);
    const paint = this.mark(channels === 'rgb' ? 'painting_rgb' : 'painting_rgba');
    this.write(to, p, [blend ? this.union(rgb, paint) : paint, channels === 'rgb' ? alpha : paint]);
  }

  underfillFrom(live: PartVisibility, to: Raster, p: number, head: Raster, full: Raster, headAlpha: number, fullAlpha: number): void {
    const [hr, ha] = this.sample(head, p), [fr, fa] = this.sample(full, p);
    // Read the production IDs for its zero-sentinel branch, even if the shadow carries a cause there.
    const fullColor = fullAlpha > 0 || live.sample(full, p)[0] !== 0;
    const rgb = headAlpha === 255 || !fullColor ? hr : headAlpha === 0 ? fr : this.union(hr, fr);
    const alpha = headAlpha === 255 || headAlpha > fullAlpha ? ha : fullAlpha > headAlpha ? fa : this.union(ha, fa);
    this.write(to, p, [rgb, alpha]);
  }

  row(live: PartVisibility, { name, x, y, image }: PlacedImage, patch: boolean) {
    const { codes } = live.states(image);
    const combinations = new Map<string, { causes: Cause[]; px: number }>();
    const decoded = new Map<number, { causes: Cause[]; recorded: boolean }>();
    const clearable = Object.fromEntries(Object.keys(BOUNDS).map(bound => [bound, 0]));
    const bounds = Object.entries(BOUNDS).map(([name, causes]) => [name, new Set<Cause>(causes)] as const);
    let opaque = 0, unrecorded = 0, mixed = 0, painting = 0, residual = 0;
    let firstResidual: [number, number] | null = null;
    for (let p = 0; p < codes.length; p++) {
      if (codes[p] === SOURCE_STATE.none) continue;
      opaque++;
      // A configured patch is cut wholesale from the painting and given a
      // synthetic alpha mask. A later seam can only replace its RGB with the same painting.
      const id = patch ? this.mark('painting_rgba') : this.union(...this.sample(image, p));
      let material = decoded.get(id);
      if (material === undefined) {
        material = {
          causes: CAUSES.filter((_, i) => this.union(id, this.causes[i]) === id),
          recorded: this.union(id, this.recorded) === id,
        };
        decoded.set(id, material);
      }
      const { causes, recorded } = material;
      if ((causes.length > 0) !== (codes[p] === SOURCE_STATE.unrecorded)) {
        throw new Error(`VISIBILITY_COVERAGE: ${name} pixel ${p} disagrees with source state ${codes[p]} (${causes.join(', ')})`);
      }
      if (causes.length === 0) continue;
      unrecorded++;
      if (recorded) mixed++;
      if (causes.includes('painting_rgb') || causes.includes('painting_rgba')) painting++;
      if (causes.includes('residual')) {
        residual++;
        firstResidual ??= [x + p % image.width, y + Math.floor(p / image.width)];
      }
      const key = causes.join('+');
      const row = combinations.get(key) ?? { causes, px: 0 };
      row.px++;
      combinations.set(key, row);
      for (const [bound, possible] of bounds) if (causes.every(cause => possible.has(cause))) clearable[bound]++;
    }
    return { part: name, opaque_px: opaque, unrecorded_px: unrecorded, recorded_and_unrecorded_px: mixed,
      painting_touched_px: painting, residual_px: residual, first_residual_rig_xy: firstResidual,
      combinations: [...combinations.values()], clearable_upper_bound_px: clearable };
  }
}

export type CoverageRow = ReturnType<Coverage['row']>;

/** Observe public transport operations without touching their IDs or outputs.
 * The caller limits assembly to paths whose material producers are covered here. */
export function observeVisibilityCoverage(patches: ReadonlySet<string>, observe: (rows: CoverageRow[]) => void): () => void {
  const prototype = PartVisibility.prototype;
  const { layer, clone, rows, copy, warp, painting, underfill, overlaps } = prototype;
  const shadows = new WeakMap<PartVisibility, Coverage>();
  function shadow(live: PartVisibility): Coverage {
    let trace = shadows.get(live);
    if (trace === undefined) shadows.set(live, trace = new Coverage());
    return trace;
  }
  // Snapshot before patching. The shadow calls these original methods directly.
  Object.assign(Coverage.prototype, { layer, clone, rows, copy, warp });
  prototype.layer = function(image, name, states) {
    layer.call(this, image, name, states);
    shadow(this).native(image, name, states);
  };
  prototype.clone = function(...args) {
    clone.apply(this, args);
    shadow(this).clone(...args);
  };
  prototype.rows = function(...args) {
    rows.apply(this, args);
    shadow(this).rows(...args);
  };
  prototype.copy = function(...args) {
    copy.apply(this, args);
    shadow(this).copy(...args);
  };
  prototype.warp = function(...args) {
    warp.apply(this, args);
    shadow(this).warp(...args);
  };
  prototype.painting = function(...args) {
    painting.apply(this, args);
    shadow(this).painting(...args);
  };
  prototype.underfill = function(...args) {
    underfill.apply(this, args);
    shadow(this).underfillFrom(this, ...args);
  };
  prototype.overlaps = function(parts) {
    const result = overlaps.call(this, parts);
    observe(parts.map(part => shadow(this).row(this, part, patches.has(part.name))));
    return result;
  };
  return () => Object.assign(prototype, { layer, clone, rows, copy, warp, painting, underfill, overlaps });
}

function preload(report: string): void {
  const [command, ...args] = process.argv.slice(2);
  const flag = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const configPath = flag('--config'), out = flag('--out');
  if (command !== 'assemble' || configPath === undefined || out === undefined ||
    ['--alt', '--propose-plan', '--emit-fill-masks'].some(arg => args.includes(arg)) || ![undefined, 'core'].includes(flag('--project'))) {
    throw new Error('VISIBILITY_COVERAGE_SCOPE: requires one recorded core-projection assemble with --config and --out');
  }
  const cfg = JSON.parse(readFileSync(configPath, 'utf8')) as { assemble: Record<string, unknown>; limbs?: unknown; scene?: unknown };
  const supported = new Set(['rig_scale', 'plan', 'extend_below_crop', 'patches', 'patches_note']);
  const extra = Object.keys(cfg.assemble).filter(key => !supported.has(key));
  if (extra.length > 0 || cfg.limbs !== undefined || cfg.scene) {
    throw new Error(`VISIBILITY_COVERAGE_SCOPE: unsupported assembly fields ${extra.join(', ')} or limbs/scene`);
  }
  const patches = new Set((cfg.assemble.patches as { name: string }[] | undefined)?.map(p => p.name));
  const readings: CoverageRow[][] = [];
  const restore = observeVisibilityCoverage(patches, rows => readings.push(rows));
  process.once('exit', code => {
    restore();
    if (code !== 0) return;
    if (readings.length !== 1) throw new Error(`VISIBILITY_COVERAGE: expected one recorded assembly, observed ${readings.length}`);
    const [rows] = readings;
    const { parts } = readParts(join(out, 'rig', 'parts.json'));
    if (parts.length !== rows.length || parts.some((part, i) =>
      part.name !== rows[i].part || part.opaque_px !== rows[i].opaque_px ||
      part.source_visibility?.unrecorded_px !== rows[i].unrecorded_px ||
      (part.from === `painting:${part.name}`) !== patches.has(part.name))) {
      throw new Error('VISIBILITY_COVERAGE: observed part order, counts or patch provenance differ from emitted parts.json');
    }
    writeFileSync(report, JSON.stringify({ spec: 'rig-parts-visibility-coverage/1',
      output_alpha_above: OPAQUE_ALPHA_ABOVE, producer_alpha_floor: ALPHA_FLOOR, bounds_remove_only: BOUNDS, parts: rows,
    }, null, 2) + '\n', { flag: 'wx' });
  });
}

const report = process.env.RIG_PARTS_VISIBILITY_COVERAGE;
if (report !== undefined) preload(report);
