/** Flat public sleeve: an asymmetric drape across one joint, no corpus input. */
import { assembleConfig, C, flatPainting, HEAD_LAYERS, writeAssembleFixture } from './assemble_fixture.ts';

export function hybridConfig(mode = true, width?: number, turns = 0): Record<string, unknown> {
  const cfg = assembleConfig({ plan: [['sleeve', 'full', 'handwear-r']], extend: [] });
  const result = { ...cfg,
    bones: [{ name: 'upper', parent: 'root', at: [30, 8], tip: [30, 30] }, { name: 'lower', parent: 'upper', at: [30, 30], tip: [30, 56] }],
    limbs: { arm: { segments: [{ part: 'proximal', from: 'sleeve', bone: 'upper' }, { part: 'distal', from: 'sleeve', bone: 'lower', joint: 'elbow', range: [-30, 30], ...(mode ? { hybrid: { part: 'joint_band', ...(width === undefined ? {} : { width }) } } : {}) }] } },
    regions: { proximal: 'upper', distal: 'lower' },
    motion: { duration: 1, tracks: [{ bone: 'lower', prop: 'rotate', amp: 0, base: 0, period: 1, phase: 0 }] },
  };
  const spin = (p: number[]): number[] => { let q = [...p]; for (let i = 0; i < turns; i++) q = [64 - q[1], q[0]]; return q; };
  for (const bone of result.bones) { bone.at = spin(bone.at); bone.tip = spin(bone.tip); }
  return result;
}
export function writeHybridFixture(dir: string, mode = true, width?: number, turns = 0): void {
  writeAssembleFixture(dir, hybridConfig(mode, width, turns), flatPainting(), { full: [{ name: 'handwear-r', depth: 0.5, rects: [
    { x0: 24, y0: 8, x1: 36, y1: 56, colour: C },
    { x0: 20, y0: 22, x1: 24, y1: 40, colour: C },
  ].map((r) => {
    for (let i = 0; i < turns; i++) r = { ...r, x0: 64 - r.y1, x1: 64 - r.y0, y0: r.x0, y1: r.x1 };
    return r;
  }) }], head: HEAD_LAYERS });
}
