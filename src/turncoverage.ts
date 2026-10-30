/** Report missing body-turn declarations from shown setup alpha and emitted fields. */
import { f32 } from '@rig-c/core/compile';
import { DRAWN_ALPHA } from '@rig-c/core/src/passthrough.ts';
import { evaluateDeformTransform, type DeformTransform } from '@rig-c/core/src/deformgen.ts';
import { computeWorldTransforms, paintingToSetupPoint, toWorld } from './coords.ts';
import { extendDepthSilhouette, sampleDepthFloat } from './depthsheets.ts';
import { edgeLength } from './length.ts';
import type { Depth25DTurnOptions } from './turn.ts';
import { rasterTurnTriangleOwnership, type TurnTriangleQuery } from './turnfield.ts';

type Mesh = NonNullable<Depth25DTurnOptions['coverageMeshes']>[number];
type Rig = Parameters<typeof computeWorldTransforms>[0];
interface Animation {
  tracks: Array<{ bone?: string; group?: string; property: string; keys: Array<{ t: number; v?: number[] | Record<string, number[]>; derive?: { degrees: number; carried?: number; depth?: number | Record<string, number> } }> }>;
  deform?: Array<{ slot: string; attachment: string; keys: Array<{ t: number; vertices?: number[]; transform?: DeformTransform }> }>;
}

/**
 * Warning only: overlap cannot prove the author's intended role. Explicit or inherited body
 * roles already declare coverage; this reader never assigns one. A one-millionth
 * pixel is the producer's six-place encoding unit, not a visual acceptance bar.
 */
export function warnUncoveredBodyTurn(
  rig: { bones: Rig; stops?: ReadonlyArray<{ links: readonly string[] }> },
  motion: { groups?: Record<string, string[]>; animations: Record<string, unknown> },
  opts: Depth25DTurnOptions,
): void {
  const body = opts.turn.body, meshes = opts.coverageMeshes;
  const anim = motion.animations.body_turn as Animation | undefined;
  if (body === undefined || meshes === undefined || anim === undefined || opts.warnings === undefined) return;
  const aliases = new Map<string, string>((rig.stops ?? []).flatMap(s => s.links.map(b => [`${b}_d`, b] as const)));
  const resolve = (b: string) => aliases.get(b) ?? b;
  const bones = rig.bones.map(b => b.parent === undefined ? b : { ...b, parent: resolve(b.parent) });
  const world = computeWorldTransforms(bones), parents = new Map(bones.map(b => [b.name, b.parent]));
  const chain = (bone: string): string[] => {
    const result: string[] = [];
    for (let b: string | undefined = resolve(bone); b !== undefined && !result.includes(b); b = parents.get(b)) result.push(b);
    return result;
  };
  const root = body.bone ?? (parents.has('chest') ? 'chest' : 'hip');
  const torso = (m: Mesh) => m.weights.every(row => row.filter(w => w.weight > 0).every(w => {
    const path = chain(w.bone);
    return path.includes(root) && !path.some(b => ['head', 'head_ctl', 'neck', 'neck_ctl'].includes(b));
  }));
  const positions = new Map(meshes.map(m => [m, m.weights.map(row => {
    let x = 0, y = 0;
    for (const w of row) { const p = toWorld(world.get(resolve(w.bone))!, w.x, w.y); x += p[0] * w.weight; y += p[1] * w.weight; }
    return [x, y];
  })]));
  const times = anim.tracks[0]?.keys;
  if (times === undefined || times.length === 0) return;
  const endpoints = [times[0], times[times.length - 1]].map(({ t }) => {
    const translations = new Map<string, number[]>();
    for (const tr of anim.tracks) {
      const key = tr.keys.find(k => k.t === t);
      if (key === undefined) continue;
      for (const bone of tr.bone === undefined ? motion.groups?.[tr.group!] ?? [] : [tr.bone]) {
        const derive = key.derive, depth = typeof derive?.depth === 'number' ? derive.depth : derive?.depth?.[bone];
        const stated = Array.isArray(key.v) ? key.v[0] : key.v?.[bone]?.[0];
        const value = f32(stated ?? -(depth! - (derive?.carried ?? 0)) * Math.sin(derive!.degrees * Math.PI / 180));
        const parent = parents.get(bone), frame = parent === undefined ? undefined : world.get(resolve(parent));
        const v = tr.property === 'translatex' ? [value, 0] : [0, value];
        translations.set(bone, frame === undefined ? v : [frame.a * v[0] + frame.b * v[1], frame.c * v[0] + frame.d * v[1]]);
      }
    }
    return new Map(meshes.map(m => {
      const key = anim.deform?.find(d => d.slot === m.slot && d.attachment === m.attachment)?.keys.find(k => k.t === t);
      let generated: number[] | undefined;
      if (key?.transform !== undefined && m.gridSamples !== undefined) {
        const p = opts.parts.find(p => p.name === m.part)!;
        const ext = extendDepthSilhouette(opts.images.get(p.depth!.image)!, opts.images.get(p.name)!);
        const z = m.gridSamples.map(([x, y]) => { const level = sampleDepthFloat(ext, x - p.x, y - p.y); return (p.depth!.near === 'black' ? 255 - level : level) * p.depth!.zScale / 255; });
        generated = evaluateDeformTransform(key.transform, positions.get(m)!.flat(), f32, `body coverage "${m.part}"`, z).offsets;
      }
      let at = 0;
      const vectors = m.weights.map((row, vi) => {
        let x = 0, y = 0;
        for (const w of row) {
          const frame = world.get(resolve(w.bone))!;
          const dx = f32(key?.vertices?.[at++] ?? 0), dy = f32(key?.vertices?.[at++] ?? 0);
          let wx = generated === undefined ? frame.a * dx + frame.b * dy : generated[2 * vi];
          let wy = generated === undefined ? frame.c * dx + frame.d * dy : generated[2 * vi + 1];
          for (const b of chain(w.bone)) { const v = translations.get(b); if (v !== undefined) { wx += v[0]; wy += v[1]; } }
          x += wx * w.weight; y += wy * w.weight;
        }
        return [x, y];
      });
      return [m, vectors] as const;
    }));
  });
  const opaque = (name: string, x: number, y: number) => {
    const p = opts.parts.find(p => p.name === name)!, image = opts.images.get(name)!;
    const px = Math.floor(x - p.x), py = Math.floor(y - p.y);
    return px >= 0 && py >= 0 && px < image.width && py < image.height && image.data[(py * image.width + px) * 4 + 3] >= DRAWN_ALPHA;
  };
  const sample = (m: Mesh, hit: { ids: number[]; weights: number[] }, endpoint: number): number[] => {
    const field = endpoints[endpoint].get(m)!;
    const [a, b, c] = hit.ids.map(i => field[i]), [u, v] = hit.weights;
    // The same translation-invariant barycentric form as sampleTurnTriangleField.
    return [0, 1].map(axis => c[axis] + u * (a[axis] - c[axis]) + v * (b[axis] - c[axis]));
  };
  const keyedBones = new Set(anim.tracks.flatMap(tr => tr.bone === undefined ? motion.groups?.[tr.group!] ?? [] : [tr.bone]));
  const pairs: Array<{ part: Depth25DTurnOptions['parts'][number]; surface: string; source: Depth25DTurnOptions['parts'][number]; targets: Mesh[]; supports: Mesh[] }> = [];
  for (const part of opts.parts) {
    if (body.roles[part.name] !== undefined) continue;
    const targets = meshes.filter(m => m.part === part.name && torso(m));
    if (targets.length === 0 || targets.every(m => m.weights.every(row => row.filter(w => w.weight > 0).every(w => chain(w.bone).some(b => keyedBones.has(b)))))) continue;
    for (const [surface, role] of Object.entries(body.roles)) {
      if (role !== 'surface') continue;
      const source = opts.parts.find(p => p.name === surface)!;
      const supports = meshes.filter(m => m.part === surface);
      pairs.push({ part, surface, source, targets, supports });
    }
  }
  const requested = new Map<Mesh, Map<string, TurnTriangleQuery>>();
  for (const { part, source, targets, supports } of pairs) {
    for (let y = Math.max(part.y, source.y); y < Math.min(part.y + part.h, source.y + source.h); y++) {
      for (let x = Math.max(part.x, source.x); x < Math.min(part.x + part.w, source.x + source.w); x++) {
        if (!opaque(part.name, x + 0.5, y + 0.5) || !opaque(source.name, x + 0.5, y + 0.5)) continue;
        for (const target of targets) {
          const point = paintingToSetupPoint([x + 0.5, y + 0.5], target.canvas, target.canvas), key = `${point[0]},${point[1]}`;
          for (const mesh of [target, ...supports]) {
            let cells = requested.get(mesh);
            if (cells === undefined) { cells = new Map(); requested.set(mesh, cells); }
            if (!cells.has(key)) cells.set(key, { x: point[0], y: point[1], point });
          }
        }
      }
    }
  }
  const ownership = new Map([...requested].map(([mesh, cells]) => [mesh, rasterTurnTriangleOwnership(positions.get(mesh)!, mesh.triangles ?? [], [...cells.values()])]));
  for (const { part, surface, source, targets, supports } of pairs) {
    const readings = [0, 1].map(() => ({ relative: 0, point: [0, 0], part: [0, 0], surface: [0, 0] }));
    for (let y = Math.max(part.y, source.y); y < Math.min(part.y + part.h, source.y + source.h); y++) {
      for (let x = Math.max(part.x, source.x); x < Math.min(part.x + part.w, source.x + source.w); x++) {
        const px = x + 0.5, py = y + 0.5;
        if (!opaque(part.name, px, py) || !opaque(surface, px, py)) continue;
        for (const target of targets) for (const support of supports) {
          const p = paintingToSetupPoint([px, py], target.canvas, target.canvas);
          const a = ownership.get(target)?.at(p[0], p[1]) ?? null;
          const b = ownership.get(support)?.at(p[0], p[1]) ?? null;
          if (a === null || b === null) continue;
          for (const [endpoint, reading] of readings.entries()) {
            const av = sample(target, a, endpoint), bv = sample(support, b, endpoint);
            const relative = edgeLength(av[0] - bv[0], av[1] - bv[1]);
            if (edgeLength(bv[0], bv[1]) > 0.000001 && relative > reading.relative) Object.assign(reading, { relative, point: [px, py], part: av, surface: bv });
          }
        }
      }
    }
    if (readings.some(r => r.relative > 0.000001)) opts.warnings.push({
      code: 'RIG_TURN_BODY_UNCOVERED', object: `part "${part.name}"`,
      detail: `overlaps moved body surface "${surface}" at alpha >= ${DRAWN_ALPHA} without a config.turn.body role; body_turn endpoints ${readings.map((r, i) => `t=${i === 0 ? times[0].t : times[times.length - 1].t}: part displacement [${r.part.join(', ')}], surface displacement [${r.surface.join(', ')}], relative ${r.relative} rig px at setup painting [${r.point.join(', ')}]`).join('; ')}; declare the intended body role and inspect both endpoints; no role or depth is inferred`,
    });
  }
}
