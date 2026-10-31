/**
 * The one door to the coordinate conversion.
 *
 * Everything this package measures is in crop pixels — y down, origin at the
 * top-left — because that is what a painting, a See-through layer and a part
 * PNG are. Spine's world is y up with its origin at the bottom-left of the
 * crop. rig-c owns that conversion (`src/transform.ts`: `cropToSpineY`,
 * `toBoneLocal`, `computeWorldTransforms`) and its own doctrine forbids a
 * second copy of it anywhere, so this package does not write one: every stage
 * that needs Spine coordinates imports them from here, and here re-exports
 * rigc's.
 *
 * A y flip written anywhere else in `src/` is the defect this file exists to
 * prevent; the selftest holds the tree to it.
 *
 * The same goes for a bone's frame. Since issue #73 a chain link is turned to
 * point along its chain, so a point under it is placed by inverting the
 * link's setup matrix: `src/rig.ts` evaluates the setup pose with rigc's
 * `computeExactFrameTransforms` (the textbook arithmetic, in which an
 * unturned bone's frame is the identity exactly, so a bone that is not turned
 * writes the very numbers it wrote before) and binds through `toBoneLocal`;
 * `flattenRig` goes back through `toWorld`. No rotation matrix is written out
 * by hand in this package.
 */
import { cropToSpineY } from '@rig-c/core/transform';

/** A painting point on the accepted integer rig canvas, in setup-world coordinates. */
export function paintingToSetupPoint(point: readonly number[], sourceSize: readonly number[], rigSize: readonly number[]): [number, number] {
  return [point[0] * (rigSize[0] / sourceSize[0]) - rigSize[0] / 2, cropToSpineY(point[1] * (rigSize[1] / sourceSize[1]), rigSize[1])];
}

/** Inverse of paintingToSetupPoint; cropToSpineY is its own inverse. */
export function setupToPaintingPoint(point: readonly number[], sourceSize: readonly number[], rigSize: readonly number[]): [number, number] {
  return [(point[0] + rigSize[0] / 2) / (rigSize[0] / sourceSize[0]), cropToSpineY(point[1], rigSize[1]) / (rigSize[1] / sourceSize[1])];
}

export { computeExactFrameTransforms, computeWorldTransforms, cropToSpineY, normaliseDegrees, toBoneLocal, toBoneLocalVector, toWorld } from '@rig-c/core/transform';
export type { BoneTransform } from '@rig-c/core/transform';
