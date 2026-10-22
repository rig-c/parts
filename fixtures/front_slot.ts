/**
 * Synthetic, hand-counted source for issue #664 (a limb segment's front slot);
 * flat colour blocks only, no painting or corpus is imported.
 *
 * The rig is 64x64 and a full-run pixel is a rig pixel (the assemble fixture's
 * scale: painting 128, run 64, `rig_scale` 0.5); a head-run pixel (x, y) is rig
 * pixel (x / 2 + 16, y / 2). Every rectangle is [x0, x1) x [y0, y1) in rig px.
 *
 * - `torso` (full:topwear, `NAVY`): [18, 44) x [16, 50), on bone `chest`.
 * - `face` (head:face, `FACE`): head run [8, 24) x [16, 40) -> rig [20, 28) x
 *   [8, 20), so it is drawn over the torso's rows 16..19.
 * - `arm` (full:handwear-r, `ARM`), the limb `arm_r` on chain `sleeve_r`
 *   (12, 18) -> (12, 32), tip (12, 46): base upper arm [9, 16) x [18, 32),
 *   forearm [8, 17) x [32, 46) — left of the torso, never over it. Plan order
 *   draws the arm first, behind the torso.
 * - set `chest`: the same upper arm; the forearm turned to world 0 degrees
 *   (`drawn.sleeve_r1`), painted [8, 28) x [29, 36) across the torso. Its
 *   painting shows the forearm over the torso; its topwear layer is the whole
 *   torso block.
 *
 * The pixel {@link FRONT_PROBE} (22, 33) lies in the forearm's gesture block
 * and in the torso block, outside the face: there the set's forearm drawn in
 * front shows `ARM`, and drawn behind the torso shows `NAVY`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePngBytes } from '../src/raster/png.ts';
import { assembleConfig, C, NAVY, paint, type RGB, type Rect, type RunLayerSpec, writeAssembleFixture, writeRun } from './assemble_fixture.ts';

export const ARM: RGB = [200, 40, 40];
export const FACE: RGB = [240, 200, 160];
export const TORSO: RGB = NAVY;
/** A rig pixel in the gesture forearm and the torso, off the face (see the module doc). */
export const FRONT_PROBE: readonly [number, number] = [22, 33];

const r = (x0: number, y0: number, x1: number, y1: number, colour: RGB): Rect => ({ x0, y0, x1, y1, colour });
const TORSO_RECT = r(18, 16, 44, 50, TORSO);
const UPPER = r(9, 18, 16, 32, ARM);
const FOREARM_BASE = r(8, 32, 17, 46, ARM);
const FOREARM_CHEST = r(8, 29, 28, 36, ARM);
/** Head-run rectangle of the face: rig [20, 28) x [8, 20). */
const FACE_RUN = r(8, 16, 24, 40, FACE);
const FACE_RIG = r(20, 8, 28, 20, FACE);

/** The painting at 2x the rig, rectangles in draw order (later over earlier), over `C`. */
function painting(rects: Rect[]): ReturnType<typeof paint> {
  return paint(128, 128, C, rects.map((q) => ({ ...q, x0: q.x0 * 2, y0: q.y0 * 2, x1: q.x1 * 2, y1: q.y1 * 2 })));
}

export interface FrontSlotOptions {
  /** Declare `config.limbs.arm_r.front` (default true). */
  limbFront?: boolean;
  /** The set `chest` names `front: ["forearm_r"]` (default true). */
  setFront?: boolean;
}

/** The fixture in `dir`: `painting.png`, `full/`, `head/`, `chest.png`, `chest_full/`, `config.json`. */
export function writeFrontSlotFixture(dir: string, opts: FrontSlotOptions = {}): Record<string, unknown> {
  const limbFront = opts.limbFront ?? true;
  const setFront = opts.setFront ?? true;
  const cfg = assembleConfig({ plan: [['arm', 'full', 'handwear-r'], ['torso', 'full', 'topwear'], ['face', 'head', 'face']], extend: [] });
  cfg.bones = [
    { name: 'chest', parent: 'root', at: [31, 16] },
    { chain: 'sleeve_r', parent: 'chest', points: [[12, 18], [12, 32]], tip: [12, 46] },
  ];
  cfg.limbs = {
    arm_r: {
      segments: [
        { part: 'upperarm_r', from: 'arm', bone: 'sleeve_r0' },
        { part: 'forearm_r', from: 'arm', bone: 'sleeve_r1', joint: 'elbow' },
      ],
      ...(limbFront ? { front: { parts: ['forearm_r'], after: 'face' } } : {}),
    },
  };
  cfg.regions = { upperarm_r: 'sleeve_r0', forearm_r: 'sleeve_r1', torso: 'chest', face: 'chest' };
  // An explicit static track closes the declared idle duration at rigc's gate.
  cfg.motion = { duration: 1, tracks: [{ bone: 'chest', prop: 'rotate', amp: 0, base: 0, period: 1, phase: 0 }] };
  (cfg.assemble as Record<string, unknown>).alternates = [
    { name: 'chest', source: 'chest.png', full: 'chest_full', head: 'head', parts: ['upperarm_r', 'forearm_r'], drawn: { sleeve_r1: 0 }, ...(setFront ? { front: ['forearm_r'] } : {}) },
  ];
  const arm = (rects: Rect[]): RunLayerSpec => ({ name: 'handwear-r', depth: 0.7, rects });
  const topwear: RunLayerSpec = { name: 'topwear', depth: 0.5, rects: [TORSO_RECT] };
  const head: RunLayerSpec[] = [{ name: 'face', depth: 0.3, rects: [FACE_RUN] }];
  writeAssembleFixture(dir, cfg, painting([UPPER, FOREARM_BASE, TORSO_RECT, FACE_RIG]), { full: [arm([UPPER, FOREARM_BASE]), topwear], head });
  writeFileSync(join(dir, 'chest.png'), encodePngBytes(painting([UPPER, TORSO_RECT, FACE_RIG, FOREARM_CHEST])));
  writeRun(join(dir, 'chest_full'), [arm([UPPER, FOREARM_CHEST]), topwear]);
  return cfg;
}
