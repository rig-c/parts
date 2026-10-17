/**
 * Ground-truth bust contour region calibration across the five calibrated
 * example characters (`A`–`E`; each shared across three outfit sets `office`,
 * `homewear`, `swimwear` in `parts-examples` commit `302f0e0`, so the
 * independent sample size is 5 characters / 15 outfit configs) and the
 * closed-form fit (`α = 0.22`, `ε = 3.8 px`, issue #475).
 */
import { DEFAULT_BUST_ALPHA, DEFAULT_BUST_CLEARANCE, type Point } from '../src/config.ts';
import { edgeLength } from '../src/length.ts';

export interface CalibratedBustSide {
  cx: number;
  cy: number;
  r: number;
  band: number;
  R: number;
  alpha: number;
}

export interface CalibratedBustFixture {
  id: 'A' | 'B' | 'C' | 'D' | 'E';
  outfits: readonly ['office', 'homewear', 'swimwear'];
  pose: '3/4 right' | 'front' | '3/4 left';
  calibrated: {
    bust_r: CalibratedBustSide;
    bust_l: CalibratedBustSide;
    D: number;
    gap: number;
    eps_sym: number;
  };
  landmarks: {
    apex_r: Point;
    apex_l: Point;
    cleavage: Point;
  };
  torso: {
    neck: Point;
    chest: Point;
    hip: Point;
  };
  derived: {
    bust_r: { R: number; r: number; band: number };
    bust_l: { R: number; r: number; band: number };
  };
  residual: {
    dR_r: number;
    dR_l: number;
    dr_r: number;
    dr_l: number;
    dband_r: number;
    dband_l: number;
  };
  /** Rejected torso-midline projection fallback residuals `[ΔR_r, ΔR_l]` at `ε = 3.8 px` (0/5 within 6 px). */
  midlineFallbackResidual: {
    chestProjection: readonly [number, number];
    neckHipIntersection: readonly [number, number];
  };
}

export const BUST_FIT_ALPHA = DEFAULT_BUST_ALPHA;
export const BUST_FIT_CLEARANCE = DEFAULT_BUST_CLEARANCE;
export const BUST_RESIDUAL_BOUND_PX = 6;

/**
 * Project `chest` perpendicularly onto the apex segment `apex_r -> apex_l` and intersect the `neck -> hip` line with
 * `apex_r -> apex_l`: the two candidate torso-midline fallbacks for `cleavage`, both rejected at 0/5 within 6 px on
 * 3/4-yaw characters (issue #475).
 */
export function midlineFallbackCleavage(f: CalibratedBustFixture): {
  chestProjection: { point: Point; dR_r: number; dR_l: number };
  neckHipIntersection: { point: Point; dR_r: number; dR_l: number };
} {
  const [rx, ry] = f.landmarks.apex_r;
  const [lx, ly] = f.landmarks.apex_l;
  const [cx, cy] = f.torso.chest;
  const [nx, ny] = f.torso.neck;
  const [hx, hy] = f.torso.hip;
  const abx = lx - rx;
  const aby = ly - ry;
  const ab2 = abx * abx + aby * aby;
  const tChest = Math.max(0, Math.min(1, ((cx - rx) * abx + (cy - ry) * aby) / ab2));
  const pChest: Point = [rx + tChest * abx, ry + tChest * aby];
  const rChestR = Math.round(edgeLength(pChest[0] - rx, pChest[1] - ry) - BUST_FIT_CLEARANCE);
  const rChestL = Math.round(edgeLength(pChest[0] - lx, pChest[1] - ly) - BUST_FIT_CLEARANCE);

  const nhx = hx - nx;
  const nhy = hy - ny;
  const det = abx * -nhy - aby * -nhx;
  const tLine = Math.abs(det) > 1e-9 ? Math.max(0, Math.min(1, ((nx - rx) * -nhy - (ny - ry) * -nhx) / det)) : 0.5;
  const pLine: Point = [rx + tLine * abx, ry + tLine * aby];
  const rLineR = Math.round(edgeLength(pLine[0] - rx, pLine[1] - ry) - BUST_FIT_CLEARANCE);
  const rLineL = Math.round(edgeLength(pLine[0] - lx, pLine[1] - ly) - BUST_FIT_CLEARANCE);

  return {
    chestProjection: {
      point: pChest,
      dR_r: rChestR - f.calibrated.bust_r.R,
      dR_l: rChestL - f.calibrated.bust_l.R,
    },
    neckHipIntersection: {
      point: pLine,
      dR_r: rLineR - f.calibrated.bust_r.R,
      dR_l: rLineL - f.calibrated.bust_l.R,
    },
  };
}

export const CALIBRATED_BUST_FIXTURES: readonly CalibratedBustFixture[] = [
  {
    id: 'A',
    outfits: ['office', 'homewear', 'swimwear'],
    pose: '3/4 right',
    calibrated: {
      bust_r: { cx: 295, cy: 665, r: 21, band: 83, R: 104, alpha: 0.2019 },
      bust_l: { cx: 496, cy: 661, r: 20, band: 71, R: 91, alpha: 0.2198 },
      D: 201.04,
      gap: 6.04,
      eps_sym: 3.02,
    },
    landmarks: {
      apex_r: [295, 665],
      apex_l: [496, 661],
      cleavage: [402, 663],
    },
    torso: { neck: [365, 450], chest: [360, 657], hip: [350, 960] },
    derived: {
      bust_r: { R: 103, r: 23, band: 80 },
      bust_l: { R: 90, r: 20, band: 70 },
    },
    residual: { dR_r: -1, dR_l: -1, dr_r: 2, dr_l: 0, dband_r: -3, dband_l: -1 },
    midlineFallbackResidual: { chestProjection: [-43, 41], neckHipIntersection: [-44, 43] },
  },
  {
    id: 'B',
    outfits: ['office', 'homewear', 'swimwear'],
    pose: '3/4 right',
    calibrated: {
      bust_r: { cx: 318, cy: 776, r: 23, band: 62, R: 85, alpha: 0.2706 },
      bust_l: { cx: 498, cy: 780, r: 21, band: 56, R: 77, alpha: 0.2727 },
      D: 180.04,
      gap: 18.04,
      eps_sym: 9.02,
    },
    landmarks: {
      apex_r: [318, 776],
      apex_l: [498, 780],
      cleavage: [412, 778],
    },
    torso: { neck: [370, 625], chest: [368, 790], hip: [368, 1020] },
    derived: {
      bust_r: { R: 90, r: 20, band: 70 },
      bust_l: { R: 82, r: 18, band: 64 },
    },
    residual: { dR_r: 5, dR_l: 5, dr_r: -3, dr_l: -3, dband_r: 8, dband_l: 8 },
    midlineFallbackResidual: { chestProjection: [-39, 49], neckHipIntersection: [-38, 48] },
  },
  {
    id: 'C',
    outfits: ['office', 'homewear', 'swimwear'],
    pose: '3/4 right',
    calibrated: {
      bust_r: { cx: 382, cy: 747, r: 22, band: 81, R: 103, alpha: 0.2136 },
      bust_l: { cx: 572, cy: 732, r: 18, band: 62, R: 80, alpha: 0.225 },
      D: 190.59,
      gap: 7.59,
      eps_sym: 3.8,
    },
    landmarks: {
      apex_r: [382, 747],
      apex_l: [572, 732],
      cleavage: [488.5, 738.5],
    },
    torso: { neck: [428, 564], chest: [440, 734], hip: [460, 995] },
    derived: {
      bust_r: { R: 103, r: 23, band: 80 },
      bust_l: { R: 80, r: 18, band: 62 },
    },
    residual: { dR_r: 0, dR_l: 0, dr_r: 1, dr_l: 0, dband_r: -1, dband_l: 0 },
    midlineFallbackResidual: { chestProjection: [-48, 48], neckHipIntersection: [-47, 47] },
  },
  {
    id: 'D',
    outfits: ['office', 'homewear', 'swimwear'],
    pose: 'front',
    calibrated: {
      bust_r: { cx: 287, cy: 826, r: 21, band: 83, R: 104, alpha: 0.2019 },
      bust_l: { cx: 501, cy: 827, r: 21, band: 85, R: 106, alpha: 0.1981 },
      D: 214.0,
      gap: 4.0,
      eps_sym: 2.0,
    },
    landmarks: {
      apex_r: [287, 826],
      apex_l: [501, 827],
      cleavage: [393, 826.5],
    },
    torso: { neck: [380, 645], chest: [380, 780], hip: [385, 1020] },
    derived: {
      bust_r: { R: 102, r: 22, band: 80 },
      bust_l: { R: 104, r: 23, band: 81 },
    },
    residual: { dR_r: -2, dR_l: -2, dr_r: 1, dr_l: 2, dband_r: -3, dband_l: -4 },
    midlineFallbackResidual: { chestProjection: [-15, 11], neckHipIntersection: [-12, 9] },
  },
  {
    id: 'E',
    outfits: ['office', 'homewear', 'swimwear'],
    pose: '3/4 left',
    calibrated: {
      bust_r: { cx: 257, cy: 752, r: 15, band: 58, R: 73, alpha: 0.2055 },
      bust_l: { cx: 418, cy: 758, r: 21, band: 65, R: 86, alpha: 0.2442 },
      D: 161.11,
      gap: 2.11,
      eps_sym: 1.06,
    },
    landmarks: {
      apex_r: [257, 752],
      apex_l: [418, 758],
      cleavage: [331, 754.75],
    },
    torso: { neck: [435, 585], chest: [410, 780], hip: [385, 995] },
    derived: {
      bust_r: { R: 70, r: 15, band: 55 },
      bust_l: { R: 83, r: 18, band: 65 },
    },
    residual: { dR_r: -3, dR_l: -3, dr_r: 0, dr_l: -3, dband_r: -3, dband_l: 0 },
    midlineFallbackResidual: { chestProjection: [77, -83], neckHipIntersection: [80, -86] },
  },
] as const;
