/**
 * Automated verification controls and planted failures for the two-tier CI
 * planner (`scripts/ci_tier.ts`, issue #1505).
 *
 * Exercises all six Phase B bars:
 *   1. Replay the 30 merged PRs from Phase A (#1507..#1440) through the
 *      implemented selector and reproduce the Phase A table (with the two
 *      added cross-stage rows: `src/check.ts` -> `chain`, `src/rig.ts` and
 *      turn sources -> `build`).
 *   2. Each of the four historical misses (#1317, #938, #958, #889) selects
 *      the suite that went red (`chain` for #1317/#938, `build` for #958/#889).
 *   3. A planted change to an unmapped path runs everything (`tier: full`),
 *      every tracked file in the repository matches a rule (`0` unmapped), and
 *      changes to `ci.yml` or `scripts/ci_tier.ts` run the full tier.
 *   4. A release-shaped PR (by title, head commit subject, or `package.json`
 *      in the diff) runs the full tier.
 *   5. The scheduled job's issue text is built from a fake failing-job list
 *      and names every failing job, its failing steps, and the commit range
 *      since the last green full run.
 *   6. `test` and `installs` are present in both tiers in `.github/workflows/ci.yml`,
 *      and the light-tier shard record + merge round trip exits 0 on green and
 *      1 on a planted failure.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treeFiles } from '../selftest.ts';
import {
  buildScheduledFailureIssue,
  buildSelftestFunctionIndex,
  type CiTierPlan,
  matchPathRule,
  mergeLightShards,
  PATH_TO_SUITE_MAP,
  planCiTier,
  readSelftestRegistry,
  resolveSelftestDiffSuites,
  ROOT,
  runLightShard,
} from './ci_tier.ts';

interface HistoricalPr {
  readonly number: number;
  readonly sha: string;
  readonly title: string;
  readonly files: readonly string[];
  readonly expectedTier: 'light' | 'full';
  }

/** The 30 merged PRs from Phase A (#1507 down to #1440 at origin/main d8897dc). */
export const PHASE_A_30_PRS: readonly HistoricalPr[] = [
  {
    "number": 1507,
    "sha": "d8897dc",
    "title": "fix(examples): compose every public rig build",
    "files": [
      ".github/workflows/ci.yml",
      "examples/demo/README.md",
      "examples/demo/animations.json",
      "examples/demo/config.json",
      "examples/demo/expected/check.json",
      "examples/demo/expected/gate_spine-html.txt",
      "examples/demo/expected/machine-class.txt",
      "examples/demo/expected/motion.json",
      "examples/demo/expected/rig.json",
      "examples/scarf/README.md",
      "examples/scarf/animations.json",
      "examples/scarf/config.json",
      "examples/scarf/expected/check.json",
      "examples/scarf/expected/gate_spine-html.txt",
      "examples/scarf/expected/machine-class.txt",
      "examples/scarf/expected/motion.json",
      "examples/scarf/expected/rig.json",
      "selftest.ts",
      "tools/regenerate_examples.ts"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1502,
    "sha": "df76d56",
    "title": "chore: release 2.55.0",
    "files": [
      "CHANGELOG.md",
      "package.json"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1501,
    "sha": "07c2f9b",
    "title": "feat(compose): add opt-in character placement pivots (#1498)",
    "files": [
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "fixtures/scene.ts",
      "selftest.ts",
      "src/scene.ts",
      "src/sceneclips.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1496,
    "sha": "851f565",
    "title": "chore: release 2.54.0",
    "files": [
      "CHANGELOG.md",
      "package.json"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1495,
    "sha": "2c1a480",
    "title": "feat(compose): let a character opt in to leaving a crop canvas (#1491)",
    "files": [
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "fixtures/scene.ts",
      "selftest.ts",
      "src/runstamp.ts",
      "src/scene.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1493,
    "sha": "e14d97a",
    "title": "fix(check): keep check.json SKIP reasons location independent (#1492)",
    "files": [
      "selftest.ts",
      "src/check.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1489,
    "sha": "3c72fcd",
    "title": "fix(plate): keep declared background props out of the removal mask (#1267)",
    "files": [
      "cli.ts",
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "fixtures/classified_plate.ts",
      "src/comfy/plate.ts",
      "src/plate.ts",
      "src/platecomponents.ts",
      "tools/check_classified_plate.ts",
      "tools/check_plate.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1488,
    "sha": "f0b3fa8",
    "title": "chore: release 2.53.0",
    "files": [
      "CHANGELOG.md",
      "package.json"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1486,
    "sha": "0c15f61",
    "title": "fix(compose): prefix and place physics-keyed animation tracks",
    "files": [
      "docs/AUTHORING.md",
      "selftest.ts",
      "src/motion.ts",
      "src/scene.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1482,
    "sha": "f111f1f",
    "title": "test: read visibility coverage causes on a recorded assembly",
    "files": [
      "tools/check_part_visibility.ts",
      "tools/read_visibility_coverage.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1479,
    "sha": "902e540",
    "title": "feat(assemble): report native draw-order inversion evidence",
    "files": [
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "src/assemble.ts",
      "src/parts.ts",
      "src/partscheck.ts",
      "src/partvisibility.ts",
      "tools/check_part_visibility.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1476,
    "sha": "c7bd8ef",
    "title": "feat(assemble): report draw-order inversions against the visibility record",
    "files": [
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "selftest.ts",
      "src/assemble.ts",
      "src/build.ts",
      "src/parts.ts",
      "src/partscheck.ts",
      "src/partvisibility.ts",
      "tools/check_part_visibility.ts",
      "tools/parts_file_field_inventory.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1475,
    "sha": "374c649",
    "title": "feat(check): report occluded source texels a pose exposes",
    "files": [
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "selftest.ts",
      "src/assemble.ts",
      "src/build.ts",
      "src/check.ts",
      "src/checkrow.ts",
      "src/parts.ts",
      "src/partvisibility.ts",
      "src/requirements.ts",
      "src/runstamp.ts",
      "src/sourceexposure.ts",
      "src/sourcestates.ts",
      "tools/check_part_visibility.ts",
      "tools/check_source_exposure.ts",
      "tools/parts_file_field_inventory.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1472,
    "sha": "d428bb7",
    "title": "feat(assemble): report See-through source visibility per part",
    "files": [
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "fixtures/parts_check_checks.ts",
      "selftest.ts",
      "src/assemble.ts",
      "src/build.ts",
      "src/editedparts.ts",
      "src/layers.ts",
      "src/paintingedges.ts",
      "src/parts.ts",
      "src/partscheck.ts",
      "src/partvisibility.ts",
      "src/raster/warp.ts",
      "src/takelayers.ts",
      "src/takeregion.ts",
      "src/visibility.ts",
      "tools/check_part_visibility.ts",
      "tools/parts_file_field_inventory.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1470,
    "sha": "7426dc6",
    "title": "feat(comfy): record See-through layer visibility (#1469)",
    "files": [
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "fixtures/fakecomfy.ts",
      "selftest.ts",
      "src/comfy/seethrough.ts",
      "src/visibility.ts",
      "tools/check_depthsheets.ts",
      "tools/check_visibility.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1464,
    "sha": "2679691",
    "title": "chore: release 2.52.1",
    "files": [
      "CHANGELOG.md",
      "package.json"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1463,
    "sha": "41e22cb",
    "title": "fix(check): omit physics-only animations from the keyed build (#1461)",
    "files": [
      "docs/AUTHORING.md",
      "selftest.ts",
      "src/build.ts",
      "src/check.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1459,
    "sha": "af399e4",
    "title": "ci: split the cli suite into case groups and run five shards (#1456)",
    "files": [
      ".github/workflows/ci.yml",
      "scripts/tree-verdict.json",
      "selftest.ts"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1458,
    "sha": "94b036d",
    "title": "chore: release 2.52.0",
    "files": [
      "CHANGELOG.md",
      "package.json"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1457,
    "sha": "d9490f5",
    "title": "fix(rig): refuse a part PNG whose opaque pixel count differs from parts.json (#1454)",
    "files": [
      "docs/AUTHORING.md",
      "fixtures/explicitmesh.ts",
      "fixtures/meshdraft.ts",
      "fixtures/rig.ts",
      "fixtures/turn_units.ts",
      "selftest.ts",
      "src/rig.ts",
      "tools/check_explicitmesh.ts",
      "tools/check_limb_layout.ts",
      "tools/check_limb_slots.ts",
      "tools/check_turn_coverage.ts",
      "tools/check_turn_surface.ts",
      "tools/check_waist.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1455,
    "sha": "dc4e0e5",
    "title": "ci: re-place SHARDS from current unit clocks (#1452)",
    "files": [
      "selftest.ts"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1453,
    "sha": "44fe323",
    "title": "feat(edited-parts): record where a receipted edit removed opaque pixels (#1383)",
    "files": [
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "selftest.ts",
      "src/editedparts.ts",
      "src/parts.ts",
      "tools/check_outline_specks.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1451,
    "sha": "d7f8742",
    "title": "chore: release 2.51.0",
    "files": [
      "CHANGELOG.md",
      "package.json"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1450,
    "sha": "49b2a78",
    "title": "feat(depth): depth-apply --groups applies a recorded subset of the recipe's groups (#1449)",
    "files": [
      "cli.ts",
      "docs/AUTHORING.md",
      "docs/DEPTH.md",
      "docs/STABILITY.md",
      "src/depthworkflow.ts",
      "tools/check_depthmaps.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1448,
    "sha": "24073ee",
    "title": "fix(examples): hold the expected files to a Linux build, checked whole in CI (#1439)",
    "files": [
      ".github/workflows/ci.yml",
      "docs/STABILITY.md",
      "examples/demo/README.md",
      "examples/demo/expected/check.json",
      "examples/demo/expected/machine-class.txt",
      "examples/demo/expected/parts.json",
      "examples/reference-demo/README.md",
      "examples/reference-demo/expected/check.json",
      "examples/reference-demo/expected/machine-class.txt",
      "examples/reference-sample/README.md",
      "examples/reference-sample/expected/check.json",
      "examples/reference-sample/expected/machine-class.txt",
      "examples/reference-sample/expected/mesh_report.json",
      "examples/reference-sample/expected/parts.json",
      "examples/reference-sample/expected/rig.json",
      "examples/scarf/README.md",
      "examples/scarf/expected/check.json",
      "examples/scarf/expected/machine-class.txt",
      "examples/scarf/expected/parts.json",
      "examples/wind/README.md",
      "examples/wind/expected-wave/parts.json",
      "examples/wind/expected/check.json",
      "examples/wind/expected/machine-class.txt",
      "examples/wind/expected/parts.json",
      "examples/wind/expected/rig.json",
      "fixtures/regenerate_validation.ts",
      "fixtures/validation-inputs/README.md",
      "fixtures/validation-inputs/expected/cloth/check.json",
      "fixtures/validation-inputs/expected/cloth/machine-class.txt",
      "fixtures/validation-inputs/expected/gesture/check.json",
      "fixtures/validation-inputs/expected/gesture/machine-class.txt",
      "fixtures/validation-inputs/expected/no-neck/check.json",
      "fixtures/validation-inputs/expected/no-neck/machine-class.txt",
      "fixtures/validation-inputs/expected/physics-driven/check.json",
      "fixtures/validation-inputs/expected/physics-driven/machine-class.txt",
      "fixtures/validation-inputs/expected/physics-mixed/check.json",
      "fixtures/validation-inputs/expected/physics-mixed/machine-class.txt",
      "fixtures/validation-inputs/expected/physics/check.json",
      "fixtures/validation-inputs/expected/physics/machine-class.txt",
      "fixtures/validation-inputs/expected/standard/check.json",
      "fixtures/validation-inputs/expected/standard/machine-class.txt",
      "fixtures/validation-inputs/expected/structure/check.json",
      "fixtures/validation-inputs/expected/structure/machine-class.txt",
      "fixtures/validation-inputs/expected/travel/check.json",
      "fixtures/validation-inputs/expected/travel/machine-class.txt",
      "scripts/lint_workflows.declarations.json",
      "selftest.ts",
      "tools/expected_form.ts",
      "tools/regenerate_examples.ts"
    ],
    "expectedTier": "full"
  },
  {
    "number": 1447,
    "sha": "edbf705",
    "title": "fix(tree): route open-coded y flips through coords and refuse new ones (#1445)",
    "files": [
      "selftest.ts",
      "src/instruments.ts",
      "src/physicscontrib.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1446,
    "sha": "e4b0308",
    "title": "fix(bust-landmarks): leave the shape pending when the act moves the points (#1443)",
    "files": [
      "cli.ts",
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "selftest.ts",
      "src/bustlandmarks.ts",
      "src/configwrite.ts",
      "tools/check_bust_landmarks.ts",
      "tools/check_bust_moved.ts",
      "tools/check_bust_shape.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1444,
    "sha": "0f413f1",
    "title": "fix(propose): check the bust points with the effective shape on both routes (#1441)",
    "files": [
      "cli.ts",
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "selftest.ts",
      "src/bustlandmarks.ts",
      "src/config.ts",
      "tools/check_bust_shape.ts"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1442,
    "sha": "d1c21d8",
    "title": "docs(claude-md): say what the examples' expected files are today",
    "files": [
      "CLAUDE.md"
    ],
    "expectedTier": "light"
  },
  {
    "number": 1440,
    "sha": "7f45c34",
    "title": "feat(propose): a chest-only write for bust landmarks on a sampled-neck config (#1436)",
    "files": [
      "cli.ts",
      "docs/AUTHORING.md",
      "docs/STABILITY.md",
      "fixtures/neck_draft.ts",
      "selftest.ts",
      "src/configwrite.ts",
      "src/propose.ts",
      "tools/check_neck_bust.ts"
    ],
    "expectedTier": "light"
  }
];

/** Measured per-unit durations (seconds) from full CI run 45291182271 on origin/main d8897dc (PR #1507). */
const RUN_45291182271_SHARD_UNITS: Readonly<Record<'1' | '2' | '3' | '4' | '5', ReadonlyArray<readonly [string, number]>>> = {
  "1": [
    [
      "build",
      502.6
    ],
    [
      "scene",
      321.8
    ],
    [
      "cli@usage-b",
      150.8
    ],
    [
      "mesh-draft",
      97.5
    ],
    [
      "check@runPlantedFeetCases",
      46.6
    ],
    [
      "check@extremes",
      37.4
    ],
    [
      "auto-mesh-examples",
      24.1
    ],
    [
      "chain@standard",
      46.6
    ],
    [
      "chain@physics",
      46.8
    ],
    [
      "chain@feature-contracts",
      5.5
    ],
    [
      "readme-loop@loop-plain",
      26.8
    ],
    [
      "chain@feature-readme-plain",
      0.7
    ],
    [
      "layers-psd",
      0.7
    ]
  ],
  "2": [
    [
      "parts",
      231.3
    ],
    [
      "check@judgements",
      185.7
    ],
    [
      "rig",
      136
    ],
    [
      "propose",
      138.3
    ],
    [
      "boundary-colour",
      99.4
    ],
    [
      "influence",
      32.4
    ],
    [
      "check@runClothCheckCases",
      47.8
    ],
    [
      "alternate-layers",
      39.1
    ],
    [
      "check@runFeetLevelCases",
      33.6
    ],
    [
      "config",
      30.6
    ],
    [
      "check@runContourStepCases",
      17.5
    ],
    [
      "check@stretch",
      22.2
    ],
    [
      "corpus",
      18.5
    ],
    [
      "chain@physics-driven",
      36.5
    ],
    [
      "chain@structure",
      33.8
    ],
    [
      "chain@feature-authoring",
      27.3
    ],
    [
      "readme-loop@loop-cloth",
      32.7
    ],
    [
      "assemble-examples@standard",
      2.1
    ],
    [
      "assemble-examples@end",
      0.4
    ]
  ],
  "3": [
    [
      "retune",
      170.7
    ],
    [
      "cli@usage-a",
      105.6
    ],
    [
      "check@runAnimationFoldCases",
      97.1
    ],
    [
      "cli@cloth",
      39.5
    ],
    [
      "chain@no-neck",
      29.1
    ],
    [
      "chain@gesture",
      31.1
    ],
    [
      "check@seated",
      22
    ],
    [
      "comfy",
      18.7
    ],
    [
      "check@runLimbCheckCases",
      14
    ],
    [
      "auto-mesh",
      12.3
    ],
    [
      "check@runDressRiderCheckCases",
      11.4
    ],
    [
      "loop",
      8.6
    ],
    [
      "build-cost",
      8.7
    ],
    [
      "waist",
      6.2
    ],
    [
      "cli@receipts",
      8.1
    ],
    [
      "cli@surface",
      8.1
    ],
    [
      "alternate-tips",
      4.4
    ],
    [
      "limb-layout",
      4
    ],
    [
      "check@runRiderCheckCases",
      3.3
    ],
    [
      "diagnostics",
      2.7
    ],
    [
      "cli@artist",
      2.3
    ],
    [
      "cli@check-flags",
      2.5
    ],
    [
      "contour",
      2.3
    ],
    [
      "inputs",
      1.5
    ],
    [
      "hybrid-limb",
      1.3
    ],
    [
      "check@runRigcIdentityCases",
      1.3
    ],
    [
      "check@coincide",
      0.8
    ],
    [
      "raster-morph",
      0.4
    ],
    [
      "core-pointer",
      0.6
    ],
    [
      "skeleton",
      0.7
    ],
    [
      "fetch-examples",
      0.4
    ],
    [
      "png",
      0.4
    ],
    [
      "chain@feature-readme-posed",
      0.4
    ],
    [
      "readme-loop@loop-posed",
      21.8
    ],
    [
      "readme-loop@end",
      16.6
    ]
  ],
  "4": [
    [
      "cli@usage-d",
      120.5
    ],
    [
      "remesh",
      161.2
    ],
    [
      "check@runEnvironmentCheckCases",
      128
    ],
    [
      "check@runMotionSeamCases",
      81.5
    ],
    [
      "assemble",
      40.4
    ],
    [
      "auto-motion",
      34.6
    ],
    [
      "check@runBreathAloneCases",
      27.4
    ],
    [
      "behind-seams",
      36.8
    ],
    [
      "fixed-skeleton",
      27.6
    ],
    [
      "check@runClothSettlesCases",
      26.1
    ],
    [
      "requirements",
      15.8
    ],
    [
      "check@runStressCases",
      20.2
    ],
    [
      "mesh-stats",
      18.2
    ],
    [
      "chain@cloth",
      37.3
    ],
    [
      "chain@physics-mixed",
      33.5
    ],
    [
      "chain@travel",
      40
    ],
    [
      "chain@end",
      51.9
    ],
    [
      "chain@feature-readme-cloth",
      0.4
    ]
  ],
  "5": [
    [
      "check@fixtures",
      221.3
    ],
    [
      "tree",
      130.7
    ],
    [
      "cli@usage-c",
      119.6
    ],
    [
      "setup-painting",
      131.3
    ],
    [
      "check@requirements",
      53.4
    ],
    [
      "check@row-scope",
      54.3
    ],
    [
      "check@weight-step",
      22.6
    ],
    [
      "cli@guide",
      22.8
    ],
    [
      "config-write",
      16.6
    ],
    [
      "check@runDiscCheckCases",
      23.4
    ],
    [
      "front-slot",
      18.9
    ],
    [
      "check@runBallCheckCases",
      12.9
    ],
    [
      "check@runSweepCheckCases",
      11.3
    ],
    [
      "depth-maps",
      11.9
    ],
    [
      "limb-slots",
      7.8
    ],
    [
      "take-layers",
      7.2
    ],
    [
      "contour-wiring",
      7.4
    ],
    [
      "editor-receipts",
      6.4
    ],
    [
      "chain-inherit",
      3.9
    ],
    [
      "arm-split-upgrade",
      4.1
    ],
    [
      "painting",
      3.3
    ],
    [
      "layers-wrapper",
      3.3
    ],
    [
      "keypoints",
      3.9
    ],
    [
      "subset-cover",
      2.5
    ],
    [
      "ground-examples",
      2.1
    ],
    [
      "foot-ownership",
      2.5
    ],
    [
      "plausibility",
      1.5
    ],
    [
      "structure",
      2.1
    ],
    [
      "part-sources",
      0.8
    ],
    [
      "raster-warp",
      0.6
    ],
    [
      "check@gate-chain",
      0.6
    ],
    [
      "winding",
      0.6
    ],
    [
      "raster-blur",
      0.4
    ],
    [
      "raster-poly",
      0.6
    ],
    [
      "joint-contact",
      0.4
    ],
    [
      "raster-components",
      0.4
    ],
    [
      "sheet",
      0.4
    ],
    [
      "prompt",
      0.4
    ],
    [
      "propose-corpus",
      0.6
    ],
    [
      "inputs-examples",
      0.6
    ],
    [
      "check@runMotionSeamWorldCases",
      0.6
    ],
    [
      "raster-composite",
      0.4
    ],
    [
      "check@runSweepUnitCases",
      0.4
    ],
    [
      "raster-resize",
      0.4
    ]
  ]
};

export function estimateShardedLightTiming(plan: CiTierPlan): { wallSec: number; runnerMin: number } {
  if (plan.tier === 'full') return { wallSec: 841.0, runnerMin: 97.8 };
  const suiteSet = new Set(plan.suites);
  const shardWalls: number[] = [];
  for (const s of ['1', '2', '3', '4', '5'] as const) {
    const w = [0, 0];
    let count = 0;
    for (const [unit, dur] of RUN_45291182271_SHARD_UNITS[s]) {
      const suite = unit.split('@')[0];
      if (!suiteSet.has(suite)) continue;
      count++;
      if (w[0] <= w[1]) w[0] += dur;
      else w[1] += dur;
    }
    const paintSec = s === '3' && plan.runPaintingPublic ? 145.0 : 0;
    shardWalls.push(count > 0 ? 30.0 + Math.max(w[0], w[1]) + paintSec : 5.0);
  }
  const maxShardSec = Math.max(...shardWalls);
  const sumShardsSec = shardWalls.reduce((a, b) => a + b, 0);
  const mergeSec = 46.0 + (plan.runStandaloneTools ? 43.0 : 0);
  const installSec = 192.0;
  const expectedSec = plan.runExpectedFiles ? 503.0 : 0;
  const wallSec = 17.0 + Math.max(maxShardSec + mergeSec, installSec, expectedSec) + 3.0;
  const totalRunnerSec = 17.0 + sumShardsSec + mergeSec + installSec + expectedSec + 6.0;
  return { wallSec, runnerMin: totalRunnerSec / 60 };
}

export async function runCiTierChecks(quiet = false): Promise<void> {
  const log = quiet ? () => {} : console.log;

  // Bar 3a: Every tracked file in the repository matches an explicit rule in PATH_TO_SUITE_MAP (0 unmapped).
  const tracked = treeFiles();
  const unmappedTracked = tracked.filter((f) => matchPathRule(f) === null);
  assert.deepEqual(unmappedTracked, [], `unmapped tracked files: ${unmappedTracked.join(', ')}`);
  const reg = readSelftestRegistry();
  assert.ok(reg.allSuiteKeys.length >= 75, `expected >= 75 selftest suites, got ${reg.allSuiteKeys.length}`);

  // Bar 1: Replay the 30 merged PRs from Phase A (#1507..#1440) and verify every tier and suite selection.
  log('=== Bar 1: Replay of the 30 merged PRs (#1507..#1440) ===');
  let lightCount = 0;
  let fullCount = 0;
  for (const pr of PHASE_A_30_PRS) {
    const plan = planCiTier({
      eventName: 'pull_request',
      prTitle: pr.title,
      changedFiles: pr.files,
    });
    assert.equal(plan.tier, pr.expectedTier, `PR #${pr.number} tier mismatch: got ${plan.tier}, expected ${pr.expectedTier}`);
    assert.ok(plan.suites.includes('tree') && plan.suites.includes('run-tally'), `PR #${pr.number} must include tree and run-tally`);
    assert.deepEqual(plan.requiredChecks, ['test', 'installs']);
    if (plan.tier === 'light') lightCount++;
    else fullCount++;
    const timing = estimateShardedLightTiming(plan);
    log(
      `#${pr.number} (${pr.sha}) [${plan.tier.toUpperCase().padEnd(5)}] wall=${(timing.wallSec / 60).toFixed(2)}m (${timing.wallSec.toFixed(0)}s) runner=${timing.runnerMin.toFixed(1)}m suites(${plan.suites.length})=[${plan.tier === 'full' ? 'ALL 75' : plan.suites.join(', ')}]`,
    );
  }
  assert.equal(lightCount, 20, `expected 20 light PRs in 30-PR replay, got ${lightCount}`);
  assert.equal(fullCount, 10, `expected 10 full PRs in 30-PR replay, got ${fullCount}`);

  // Bar 2: Each of the four historical let-throughs (#1317, #938, #958, #889) selects the suite that went red.
  log('=== Bar 2: Historical let-throughs (#1317, #938, #958, #889) ===');
  const idx = buildSelftestFunctionIndex();
  const checkFn = idx.ranges.find((r) => r.name === 'runCheckSuite');
  assert.ok(checkFn !== undefined, 'runCheckSuite must exist in selftest.ts function index');

  const pr1317 = planCiTier({
    eventName: 'pull_request',
    prTitle: 'feat(check): add check row',
    changedFiles: ['docs/AUTHORING.md', 'docs/STABILITY.md', 'selftest.ts', 'src/check.ts'],
    selftestDiff: `@@ -${checkFn.startLine + 2},1 +${checkFn.startLine + 2},2 @@\n+  // control in runCheckSuite\n`,
  });
  assert.equal(pr1317.tier, 'light');
  assert.ok(pr1317.suites.includes('chain'), '#1317 must select chain');
  assert.ok(pr1317.suites.includes('check'), '#1317 must select check');

  const pr938 = planCiTier({
    eventName: 'pull_request',
    prTitle: 'fix(check): update check output',
    changedFiles: ['src/check.ts'],
  });
  assert.equal(pr938.tier, 'light');
  assert.ok(pr938.suites.includes('chain'), '#938 must select chain');
  assert.ok(pr938.suites.includes('check'), '#938 must select check');

  const pr958 = planCiTier({
    eventName: 'pull_request',
    prTitle: 'feat(rig): update hybrid limb base joints',
    changedFiles: ['docs/AUTHORING.md', 'src/rig.ts', 'tools/check_hybrid_limb.ts'],
  });
  assert.equal(pr958.tier, 'light');
  assert.ok(pr958.suites.includes('build'), '#958 must select build');
  assert.ok(pr958.suites.includes('rig'), '#958 must select rig');

  const pr889 = planCiTier({
    eventName: 'pull_request',
    prTitle: 'feat(turn): update turn coverage and field',
    changedFiles: [
      'docs/AUTHORING.md',
      'docs/STABILITY.md',
      'src/rig.ts',
      'src/turn.ts',
      'src/turncoverage.ts',
      'src/turnfield.ts',
      'tools/check_turn_coverage.ts',
      'tools/check_turn_ownership.ts',
      'tools/check_turn_surface.ts',
    ],
  });
  assert.equal(pr889.tier, 'light');
  assert.ok(pr889.suites.includes('build'), '#889 must select build');
  assert.ok(pr889.suites.includes('rig'), '#889 must select rig');

  // Also verify pure turn-source change without src/rig.ts selects build
  const turnOnly = planCiTier({
    eventName: 'pull_request',
    prTitle: 'fix(turn): adjust turn field',
    changedFiles: ['src/turnfield.ts'],
  });
  assert.equal(turnOnly.tier, 'light');
  assert.ok(turnOnly.suites.includes('build'), 'src/turnfield.ts alone must select build');

  // Bar 3b: Planted change to an unmapped path runs everything; change to ci.yml or the map selects full tier; selftest.ts hunk resolution works.
  log('=== Bar 3: Planted unmapped path, ci.yml/map changes, and selftest.ts diff hunks ===');
  const unmappedPlan = planCiTier({
    eventName: 'pull_request',
    prTitle: 'feat: add brand new unmapped file',
    changedFiles: ['src/brand_new_unmapped_stage.ts'],
  });
  assert.equal(unmappedPlan.tier, 'full');
  assert.equal(unmappedPlan.suites.length, reg.allSuiteKeys.length);
  assert.ok(unmappedPlan.reasons.includes('unmapped:src/brand_new_unmapped_stage.ts'));

  const ciYmlPlan = planCiTier({
    eventName: 'pull_request',
    prTitle: 'ci: tweak workflow',
    changedFiles: ['.github/workflows/ci.yml'],
  });
  assert.equal(ciYmlPlan.tier, 'full');
  assert.equal(ciYmlPlan.suites.length, reg.allSuiteKeys.length);

  const mapPlan = planCiTier({
    eventName: 'pull_request',
    prTitle: 'ci: update path map',
    changedFiles: ['scripts/ci_tier.ts'],
  });
  assert.equal(mapPlan.tier, 'full');
  assert.equal(mapPlan.suites.length, reg.allSuiteKeys.length);

  const assembleFn = idx.ranges.find((r) => r.name === 'runAssembleSuite');
  assert.ok(assembleFn !== undefined, 'runAssembleSuite must exist in selftest.ts function index');
  const insideSuiteHunk = resolveSelftestDiffSuites(`@@ -${assembleFn.startLine + 3},1 +${assembleFn.startLine + 3},2 @@\n+  // inside runAssembleSuite\n`);
  assert.equal(insideSuiteHunk.full, false);
  assert.ok(insideSuiteHunk.suites.includes('assemble'));

  const outsideSuiteHunk = resolveSelftestDiffSuites('@@ -1,2 +1,3 @@\n+// top-level header edit outside suite fns\n');
  assert.equal(outsideSuiteHunk.full, true);

  // Bar 4: A release-shaped PR runs the full tier.
  log('=== Bar 4: Release-shaped PR detector ===');
  for (const title of ['chore: release 2.56.0', 'chore(main): release 2.56.0-rc.1', 'release: v2.56.0']) {
    const relTitlePlan = planCiTier({
      eventName: 'pull_request',
      prTitle: title,
      changedFiles: ['CHANGELOG.md'],
    });
    assert.equal(relTitlePlan.tier, 'full', `release title "${title}" must select full tier`);
    assert.ok(relTitlePlan.reasons.includes('release-PR'));
  }
  const relCommitPlan = planCiTier({
    eventName: 'push',
    commitSubject: 'chore: release 2.56.0',
    changedFiles: ['CHANGELOG.md'],
  });
  assert.equal(relCommitPlan.tier, 'full');
  assert.ok(relCommitPlan.reasons.includes('release-PR'));

  const pkgJsonPlan = planCiTier({
    eventName: 'pull_request',
    prTitle: 'build: bump version in package.json',
    changedFiles: ['package.json'],
  });
  assert.equal(pkgJsonPlan.tier, 'full');
  assert.ok(pkgJsonPlan.reasons.includes('package.json'));

  // Bar 5: Scheduled job's issue text is built from a fake failing-job list.
  log('=== Bar 5: Scheduled job issue text builder ===');
  const fakeIssue = buildScheduledFailureIssue({
    runId: 9988776655,
    runUrl: 'https://github.com/rig-c/parts/actions/runs/9988776655',
    headSha: '3ac8798a8af7c1701b9fb894e2213acbc81a51a4',
    lastGreenFullSha: 'df76d56f33aa98d1492578196550000000000000',
    commits: [
      { sha: '3ac8798a8af7c1701b9fb894e2213acbc81a51a4', subject: 'fix(compose): name the missing placement pivot opt-in (#1508)' },
      { sha: 'b134a1a000000000000000000000000000000000', subject: 'fix(compose): document scene-wide root motion (#1506)' },
    ],
    failedJobs: [
      {
        name: 'selftest shard 2',
        conclusion: 'failure',
        htmlUrl: 'https://github.com/rig-c/parts/actions/runs/9988776655/job/111',
        failedSteps: ["Run this shard's units"],
      },
      {
        name: 'packed install windows-latest Bun latest',
        conclusion: 'failure',
        htmlUrl: 'https://github.com/rig-c/parts/actions/runs/9988776655/job/222',
        failedSteps: ['The package installs into an empty directory and runs from there'],
      },
    ],
  });
  assert.equal(fakeIssue.title, 'ci: scheduled full run failed on main (3ac8798)');
  assert.ok(fakeIssue.body.includes('df76d56...3ac8798'), 'issue body must name short commit range');
  assert.ok(fakeIssue.body.includes('df76d56f33aa98d1492578196550000000000000...3ac8798a8af7c1701b9fb894e2213acbc81a51a4'), 'issue body must name full commit range');
  assert.ok(fakeIssue.body.includes('[selftest shard 2](https://github.com/rig-c/parts/actions/runs/9988776655/job/111) (`failure`) — step(s): `Run this shard\'s units`'));
  assert.ok(fakeIssue.body.includes('[packed install windows-latest Bun latest](https://github.com/rig-c/parts/actions/runs/9988776655/job/222) (`failure`)'));
  assert.ok(fakeIssue.body.includes('`3ac8798` fix(compose): name the missing placement pivot opt-in (#1508)'));
  assert.throws(() => buildScheduledFailureIssue({
    runId: 1,
    runUrl: 'https://github.com/rig-c/parts/actions/runs/1',
    headSha: '3ac8798a8af7c1701b9fb894e2213acbc81a51a4',
    lastGreenFullSha: null,
    commits: [],
    failedJobs: [],
  }), /requires at least one failing job/);

  // Bar 6: `test` and `installs` are present in both tiers in ci.yml, and light-tier shard+merge round trip works.
  log('=== Bar 6: Required checks in both tiers and light-tier shard/merge controls ===');
  const ciYmlText = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const ciDoc = Bun.YAML.parse(ciYmlText) as {
    on?: {
      schedule?: Array<{ cron?: string }>;
      workflow_dispatch?: { inputs?: Record<string, { default?: string }> };
    };
    jobs?: Record<string, { name?: string; if?: string; needs?: string | string[] }>;
  };
  assert.equal(ciDoc.on?.schedule?.[0]?.cron, '17 3 * * *', 'ci.yml must schedule daily full run at 17 3 * * * (03:17 UTC)');
  assert.equal(ciDoc.on?.workflow_dispatch?.inputs?.tier?.default, 'full', 'ci.yml workflow_dispatch tier input must default to full');
  assert.equal(ciDoc.jobs?.['test-status']?.name, 'test', 'test-status job must keep display name "test"');
  assert.equal(ciDoc.jobs?.['test-status']?.if, 'always()', 'test-status job must run in both tiers under if: always()');
  assert.ok(ciDoc.jobs?.installs !== undefined, 'installs job must exist in ci.yml');
  assert.equal(ciDoc.jobs?.installs?.if, 'always()', 'installs job must run in both tiers under if: always()');
  assert.ok(
    (ciDoc.jobs?.['receipt-eligible']?.if ?? '').includes("needs.tree-verdict.outputs.tier == 'full'") &&
      (ciDoc.jobs?.['receipt-eligible']?.if ?? '').includes("github.event_name != 'schedule'"),
    'receipt-eligible must guard tree-verdict-receipt to full-tier non-scheduled runs',
  );

  // Exercise mergeLightShards on synthetic green and red shard records (and a real fast shard run on png).
  const tmp = mkdtempSync(join(tmpdir(), 'rig-parts-ci-tier-check-'));
  try {
    const shardsDir = join(tmp, 'shards');
    const selected = ['png', 'run-tally'];
    for (const s of ['1', '2', '3', '4', '5']) {
      const code = await runLightShard(s, join(shardsDir, `shard-${s}.json`), selected);
      assert.equal(code, 0, `light shard ${s} on [png, run-tally] must exit 0`);
    }
    const greenMerge = mergeLightShards(shardsDir, selected);
    assert.equal(greenMerge, 0, 'mergeLightShards on green [png, run-tally] shards must exit 0');

    // Plant a failing control in the shard record holding png and verify mergeLightShards exits 1
    let plantedPng = false;
    for (const s of ['1', '2', '3', '4', '5']) {
      const sPath = join(shardsDir, `shard-${s}.json`);
      const rec = JSON.parse(readFileSync(sPath, 'utf8')) as {
        units: Array<{ key: string; stdout: string; result: string }>;
      };
      const pngUnit = rec.units.find((u) => u.key === 'png');
      if (pngUnit !== undefined) {
        pngUnit.stdout += '  FAIL  PNG_PLANTED_FAILURE: planted failure for check_ci_tier\n';
        pngUnit.result = JSON.stringify({ returned: 1 });
        writeFileSync(sPath, `${JSON.stringify(rec)}\n`);
        plantedPng = true;
        break;
      }
    }
    assert.ok(plantedPng, 'one shard must hold the png unit');
    const redMerge = mergeLightShards(shardsDir, selected);
    assert.equal(redMerge, 1, 'mergeLightShards on planted red shard record must exit 1');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('check_ci_tier: PASS — all 6 Phase B bars and planted negative controls passed.');
}

if (import.meta.main) {
  await runCiTierChecks(process.argv.includes('--quiet'));
}
