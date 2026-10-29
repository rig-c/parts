/** Explicit painting ownership, after assembly and before output cropping (#848). */
import type { Problem } from './errors.ts';
import { refuseIfAny } from './errors.ts';
import { CORE_ALPHA, OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { newMask, type Mask, type Raster } from './raster/types.ts';

export interface PaintingExtension {
  part: string;
  /** Half-open rectangle in rig pixels; no candidate or path leaves it. */
  band: [number, number, number, number];
  /** Maximum four-neighbour path length from the original target silhouette. */
  max_distance: number;
}

/** Shared by every config door and the callable assemble API. */
export function paintingExtensionProblems(value: unknown, names: ReadonlySet<string> | null = null): Problem[] {
  const at = 'config.assemble.extend_painting', out: Problem[] = [];
  const fail = (code: string, object: string, detail: string): void => { out.push({ code, object, detail }); };
  if (!Array.isArray(value)) {
    fail('CONFIG_FIELD_TYPE', at, 'requires an array of {part, band, max_distance}; omit it for no extension');
    return out;
  }
  const seen = new Set<string>();
  value.forEach((entry: unknown, i) => {
    const path = `${at}[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail('CONFIG_FIELD_TYPE', path, 'requires {part, band, max_distance}'); return;
    }
    const e = entry as Record<string, unknown>;
    for (const key of Object.keys(e)) if (!['part', 'band', 'max_distance'].includes(key)) fail('CONFIG_KEY_KNOWN', `${path}.${key}`, 'is unknown; only part, band and max_distance are read');
    for (const key of ['part', 'band', 'max_distance']) if (!(key in e)) fail('CONFIG_FIELD_PRESENT', `${path}.${key}`, 'is absent and required; no bound or target is inferred');
    if ('part' in e) {
      if (typeof e.part !== 'string' || e.part === '') fail('CONFIG_FIELD_TYPE', `${path}.part`, `is ${JSON.stringify(e.part)}; a nonempty final layer-derived output part name is required`);
      else {
        if (seen.has(e.part)) fail('CONFIG_PART_UNIQUE', `${path}.part`, `names "${e.part}" again; declare each part once`);
        seen.add(e.part);
        if (names !== null && !names.has(e.part)) fail('CONFIG_NAME_RESOLVES', `${path}.part`, `names "${e.part}"; a final layer-derived output part is required, after cuts and limb splitting — known: ${[...names].join(', ')}`);
      }
    }
    if ('band' in e && !(Array.isArray(e.band) && e.band.length === 4 && e.band.every(n => Number.isSafeInteger(n) && n >= 0) && e.band[0] < e.band[2] && e.band[1] < e.band[3])) {
      fail('CONFIG_FIELD_TYPE', `${path}.band`, `is ${JSON.stringify(e.band)}; [x0,y0,x1,y1] as nonnegative safe integers with x0 < x1 and y0 < y1 is required, rig pixels, upper bounds exclusive`);
    }
    if ('max_distance' in e && !(Number.isSafeInteger(e.max_distance) && (e.max_distance as number) > 0)) {
      fail('CONFIG_FIELD_TYPE', `${path}.max_distance`, `is ${JSON.stringify(e.max_distance)}; a positive safe integer of four-neighbour rig-pixel steps is required`);
    }
  });
  return out;
}

/**
 * Returns disjoint gain masks from one frozen final stack, without changing it.
 * Alpha >0 on ANY assembled part blocks a candidate. Only original target
 * alpha >8 seeds paths. A path stays in-band on unheld painting alpha >=250;
 * its first pixel is distance 1. Conflicting claims refuse, never pick a part.
 * RGB copying is the caller's job, from its existing RGB painting resample.
 */
export function paintingExtensionMasks(
  declarations: readonly PaintingExtension[],
  parts: readonly { name: string; image: Raster; x?: number; y?: number; canExtend?: boolean }[],
  painting: Raster,
): ReadonlyMap<string, Mask> {
  refuseIfAny(paintingExtensionProblems(declarations, new Set(parts.filter(p => p.canExtend !== false).map(p => p.name))));
  const { width: W, height: H } = painting;
  const problems: Problem[] = [];
  declarations.forEach((e, i) => {
    if (e.band[2] > W || e.band[3] > H) problems.push({ code: 'ASSEMBLE_PAINTING_BAND_INSIDE', object: `config.assemble.extend_painting[${i}] (part "${e.part}")`, detail: `band is [${e.band.join(', ')}]; rig is ${W}x${H}, so x1 <= ${W} and y1 <= ${H} are required; no clipping is applied` });
  });
  refuseIfAny(problems);
  const held = new Uint8Array(W * H), claimed = new Map<number, string>(), masks = new Map<string, Mask>();
  for (const { name, image, x = 0, y = 0 } of parts) {
    if (x < 0 || y < 0 || x + image.width > W || y + image.height > H) problems.push({ code: 'ASSEMBLE_PAINTING_CANVAS', object: `part "${name}"`, detail: `is ${image.width}x${image.height}; a final part inside the ${W}x${H} rig is required` });
    else for (let j = 0; j < image.height; j++) for (let i = 0; i < image.width; i++) if (image.data[(j * image.width + i) * 4 + 3] > 0) held[(y + j) * W + x + i] = 1;
  }
  refuseIfAny(problems);
  for (const e of declarations) {
    const target = parts.find(p => p.name === e.part)!;
    const [x0, y0, x1, y1] = e.band, bw = x1 - x0, bh = y1 - y0;
    const distance = new Uint32Array(bw * bh), queue = new Int32Array(bw * bh), gain = newMask(W, H);
    const eligible = (x: number, y: number): boolean => held[y * W + x] === 0 && painting.data[(y * W + x) * 4 + 3] >= CORE_ALPHA;
    const seed = (x: number, y: number): boolean => {
      const tx = x - (target.x ?? 0), ty = y - (target.y ?? 0);
      return tx >= 0 && ty >= 0 && tx < target.image.width && ty < target.image.height && target.image.data[(ty * target.image.width + tx) * 4 + 3] > OPAQUE_ALPHA_ABOVE;
    };
    let end = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!eligible(x, y) || !(seed(x - 1, y) || seed(x + 1, y) || seed(x, y - 1) || seed(x, y + 1))) continue;
      const q = (y - y0) * bw + x - x0;
      distance[q] = 1; queue[end++] = q;
    }
    for (let at = 0; at < end; at++) {
      const q = queue[at], x = x0 + q % bw, y = y0 + Math.floor(q / bw), p = y * W + x;
      gain.data[p] = 1;
      const previous = claimed.get(p);
      if (previous !== undefined) {
        refuseIfAny([{ code: 'ASSEMBLE_PAINTING_EXTENSION_CONFLICT', object: `parts "${previous}" and "${e.part}"`, detail: `both claim rig pixel (${x},${y}); disjoint reachable bands are required, no order-based ownership is guessed` }]);
      }
      claimed.set(p, e.part);
      if (distance[q] >= e.max_distance) continue;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
        const n = (ny - y0) * bw + nx - x0;
        if (distance[n] !== 0 || !eligible(nx, ny)) continue;
        distance[n] = distance[q] + 1; queue[end++] = n;
      }
    }
    masks.set(e.part, gain);
  }
  return masks;
}
