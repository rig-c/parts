/**
 * Parts-only fold reading (#1543): build a rig in-process with `buildRig`, no
 * rigc, and name every mesh triangle whose signed area changes sign against
 * the setup pose at a deform key of the rig's own animations — by animation,
 * key, slot, triangle and vertices, with each vertex's weights.
 *
 * A reading, not a gate. rigc's `A39_DEFORM_KEEPS_TRIANGLE_WINDING` is the
 * gate, and it runs on every `rig`; this tool exists so an author can see
 * which keys and vertices fold in the minutes `buildRig` takes, before paying
 * for the rigc round trip. Measured against rigc 3.8.1's A39 on one private
 * production build (1787 triangles, 7 failing): the same triangle indices and
 * the same rest and posed areas to three decimals, 7 of 7.
 *
 * Posing: each key's offsets are added to its weighted vertex entries, bones
 * at setup (a deform key moves no bone), one key of one animation at a time.
 * A mesh written as a `generator` (a grid rigc expands at compile) has no
 * vertices here and is listed as not read, by name; this reading covers the
 * explicit-weight meshes (contour, auto, influences) only.
 *
 *   bun tools/measure_turn_flips.ts --config <config.json> --parts <dir>
 *
 * Exit 0 when nothing folds, 1 when something does, 64 on bad arguments.
 */
import { computeWorldTransforms, toWorld } from '../src/coords.ts';
import type { MeshAttachment, RigOutput } from '../src/rig.ts';

export interface TurnFlip {
  animation: string;
  key: number;
  slot: string;
  attachment: string;
  triangle: number;
  vertices: [number, number, number];
  restArea: number;
  posedArea: number;
}

interface DeformTimeline { slot: string; attachment?: string; keys: Array<{ vertices?: number[] }> }

/** Every triangle that turns over against setup at some deform key, in animation, slot, key and triangle order. */
export function turnKeyFlips(b: RigOutput): { flips: TurnFlip[]; unread: string[] } {
  const world = computeWorldTransforms(b.rig.bones);
  const flips: TurnFlip[] = [], unread: string[] = [];
  const animations = Object.keys(b.motion.animations).sort();
  for (const [slot, attachments] of Object.entries(b.rig.skins.default)) {
    for (const [name, raw] of Object.entries(attachments)) {
      if ((raw as { type?: string }).type !== 'mesh') continue;
      const att = raw as MeshAttachment;
      if (!Array.isArray(att.weights) || att.weights.length === 0) { unread.push(`${slot}/${name}: ${att.generator === undefined ? 'no weights' : `a ${att.generator.kind} generator rigc expands`}`); continue; }
      const pose = (offsets: readonly number[]): Array<[number, number]> => {
        let at = 0;
        return att.weights.map(row => {
          let x = 0, y = 0;
          for (const w of row) {
            const [wx, wy] = toWorld(world.get(w.bone)!, w.x + (offsets[at] ?? 0), w.y + (offsets[at + 1] ?? 0));
            x += wx * w.weight; y += wy * w.weight; at += 2;
          }
          return [x, y];
        });
      };
      const tri = att.triangles, rest = pose([]);
      const area = (p: Array<[number, number]>, i: number): number => {
        const [a, c, d] = [p[tri[i]], p[tri[i + 1]], p[tri[i + 2]]];
        return ((c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0])) / 2;
      };
      for (const animation of animations) {
        const deform = (b.motion.animations[animation] as { deform?: DeformTimeline[] } | undefined)?.deform ?? [];
        const timeline = deform.find(d => d.slot === slot && (d.attachment ?? name) === name);
        if (timeline === undefined) continue;
        timeline.keys.forEach((k, key) => {
          const posed = pose(k.vertices ?? []);
          for (let i = 0; i < tri.length; i += 3) {
            const r = area(rest, i), p = area(posed, i);
            if (r * p < 0) flips.push({ animation, key, slot, attachment: name, triangle: i / 3, vertices: [tri[i], tri[i + 1], tri[i + 2]], restArea: r, posedArea: p });
          }
        });
      }
    }
  }
  return { flips, unread };
}

async function main(argv: string[]): Promise<number> {
  const value = (flag: string): string | undefined => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const config = value('--config'), parts = value('--parts');
  if (config === undefined || parts === undefined || argv.length !== 4) {
    console.error('usage: bun tools/measure_turn_flips.ts --config <config.json> --parts <dir>');
    return 64;
  }
  const { readRigInputs } = await import('../src/build.ts');
  const { buildRig } = await import('../src/rig.ts');
  const { cfg, parts: manifest, images } = readRigInputs(config, parts);
  const b = buildRig(cfg, manifest, images);
  const { flips, unread } = turnKeyFlips(b);
  for (const f of flips) {
    const weights = (b.rig.skins.default[f.slot][f.attachment] as MeshAttachment).weights;
    const who = f.vertices.map(v => `${v}(${weights[v].filter(w => w.weight > 0).map(w => `${w.bone}:${w.weight.toFixed(3)}`).join(',')})`).join(' ');
    console.log(`FOLD ${f.animation} key ${f.key} ${f.slot}/${f.attachment} triangle ${f.triangle} [${f.vertices.join(',')}] ${f.restArea.toFixed(3)} -> ${f.posedArea.toFixed(3)}; ${who}`);
  }
  for (const u of unread) console.log(`NOT READ ${u}`);
  console.log(`${flips.length} folding triangle(s); a reading — rigc's A39 is the gate`);
  return flips.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
