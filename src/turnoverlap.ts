/** Source-alpha overlap selects turn fields, never skin bindings. */
import { DRAWN_ALPHA } from 'rig-c/src/passthrough.ts';
import { computeWorldTransforms, setupToPaintingPoint, toWorld } from './coords.ts';
import type { Depth25DTurnOptions } from './turn.ts';
import type { Problem } from './errors.ts';
import { turnTriangleCoordinates } from './turnfield.ts';

type Group = 'head' | 'body';
type Surface = NonNullable<Depth25DTurnOptions['surfaceMeshes']>[number];
type Owner = NonNullable<Surface['overlapOwners']>[number];
export interface ClassifiedTurnSurface {
  mesh: Surface;
  groups: ReadonlyMap<string, Group>;
}

/**
 * The seam reader's band is the undilated setup intersection at DRAWN_ALPHA.
 * Here parts are registered one painting pixel per texel: test the source cell
 * containing the setup vertex. No bbox, nearest island, falloff or art > 0 test
 * substitutes for positive half-opacity support on BOTH drawings.
 */
export function turnOverlapOwners(
  rig: { bones: Array<{ name: string; parent?: string; x: number; y: number; rotation?: number; length?: number }>; stops?: ReadonlyArray<{ links: readonly string[] }> },
  opts: Depth25DTurnOptions,
  classified: readonly ClassifiedTurnSurface[],
  blended: ReadonlySet<string>,
  problems: Problem[],
): ReadonlyMap<Surface, ReadonlyArray<Owner>> {
  // Declared Core stop draw aliases (including parents) share the link frame.
  // This lookup does not rewrite the emitted rig or the caller's bindings.
  const aliases = new Map<string, string>((rig.stops ?? []).flatMap(s => s.links.map(link => [`${link}_d`, link] as const)));
  const resolve = (bone: string) => aliases.get(bone) ?? bone;
  const world = computeWorldTransforms(rig.bones.map(b => b.parent === undefined ? b : { ...b, parent: resolve(b.parent) }));
  const points = new Map<Surface, number[][]>();
  const neighbours = [...classified, ...(opts.neighbourMeshes ?? []).map(mesh => ({ mesh, groups: new Map<string, Group>() }))];
  for (const { mesh } of neighbours) {
    points.set(mesh, mesh.weights.map(row => {
      let x = 0, y = 0;
      for (const w of row) {
        if (w.weight === 0) continue;
        const frame = world.get(resolve(w.bone));
        if (frame === undefined) return [NaN, NaN]; // the binding reader names this refusal
        const [wx, wy] = toWorld(frame, w.x, w.y); x += wx * w.weight; y += wy * w.weight;
      }
      return setupToPaintingPoint([x, y], mesh.canvas, mesh.canvas);
    }));
  }
  const opaque = (part: Depth25DTurnOptions['parts'][number], x: number, y: number): boolean => {
    const art = opts.images.get(part.name), px = Math.floor(x - part.x), py = Math.floor(y - part.y);
    return art !== undefined && px >= 0 && py >= 0 && px < art.width && py < art.height && art.data[(py * art.width + px) * 4 + 3] >= DRAWN_ALPHA;
  };
  const result = new Map<Surface, ReadonlyArray<Owner>>();
  for (const target of classified) {
    // A part-level blend must not change a pure sibling attachment's legacy mask.
    if (!blended.has(target.mesh.part) || new Set(target.groups.values()).size !== 2) continue;
    const own = opts.parts.find(p => p.name === target.mesh.part);
    if (own === undefined) continue;
    const owners = points.get(target.mesh)!.map(([x, y], index): Owner => {
      if (!opaque(own, x, y)) return undefined;
      const anchors: Array<{ part: string; group: Group }> = [];
      for (const neighbour of opts.parts) {
        if (neighbour.name === own.name || !opaque(neighbour, x, y)) continue;
        const roles = [opts.turn.roles?.[neighbour.name], opts.turn.body?.roles[neighbour.name]];
        if (roles.every(r => r === undefined)) continue;
        const meshes = neighbours.filter(c => c.mesh.part === neighbour.name);
        const rolesGroups: Group[] = [...(roles[0] === undefined ? [] : ['head' as const]), ...(roles[1] === undefined ? [] : ['body' as const])];
        if (meshes.length === 0) {
          if (roles.some(r => r === 'unit' || r === 'rear') && opts.regions[neighbour.name] === undefined) problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_SUPPORT', object: `surface mesh "${target.mesh.slot}/${target.mesh.attachment}" vertex ${index}`, detail: `neighbour "${neighbour.name}" has no region declaration or weighted setup geometry; provide its actual weighted attachments, not source alpha alone` });
          else if (rolesGroups.length === 1) anchors.push({ part: neighbour.name, group: rolesGroups[0] });
          else problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_GROUPS', object: `surface mesh "${target.mesh.slot}/${target.mesh.attachment}" vertex ${index}`, detail: `overlaps "${neighbour.name}" in both turn groups without a single attachment group; declare one neighbour turn group or separate the overlapping art` });
          continue;
        }
        for (const candidate of meshes) {
          // A genuinely mixed neighbour has no single field to lend.
          if (new Set(candidate.groups.values()).size === 2) continue;
          if (candidate.mesh.triangles === undefined) {
            problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_SUPPORT', object: `surface mesh "${target.mesh.slot}/${target.mesh.attachment}" vertex ${index}`, detail: `overlaps "${neighbour.name}" without setup triangles for "${candidate.mesh.slot}/${candidate.mesh.attachment}"; supply the existing attachment triangles so disconnected islands can be resolved` });
            continue;
          }
          const vertices = points.get(candidate.mesh)!;
          if (vertices.some(p => !p.every(Number.isFinite))) { problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_SUPPORT', object: `turn neighbour "${candidate.mesh.slot}/${candidate.mesh.attachment}"`, detail: 'has unresolved setup bindings; every positive influence must resolve before overlap is classified' }); continue; }
          if (turnTriangleCoordinates(vertices, candidate.mesh.triangles, x, y) === null) continue;
          const groups = blended.has(neighbour.name) ? [...new Set(candidate.groups.values())] : rolesGroups;
          if (groups.length === 1) anchors.push({ part: neighbour.name, group: groups[0] });
          else problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_GROUPS', object: `surface mesh "${target.mesh.slot}/${target.mesh.attachment}" vertex ${index}`, detail: `overlaps "${neighbour.name}" with ${groups.length} active turn groups; one neighbour group is required, or separate the overlapping art` });
        }
      }
      const groups = [...new Set(anchors.map(a => a.group))];
      if (groups.length > 1) problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_GROUPS', object: `surface mesh "${target.mesh.slot}/${target.mesh.attachment}" vertex ${index}`, detail: `setup alpha overlap at (${x}, ${y}) receives conflicting fields from ${anchors.map(a => `"${a.part}" (${a.group})`).join(', ')}; one neighbour group is required, or separate the overlapping art` });
      return groups.length === 1 ? { group: groups[0], neighbours: [...new Set(anchors.map(a => a.part))] } : undefined;
    });
    if (owners.some(owner => owner !== undefined)) result.set(target.mesh, owners);
  }
  return result;
}
