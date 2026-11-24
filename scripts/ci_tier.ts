/**
 * Two-tier CI planner, path-to-suite selector, light-tier shard runner/merger,
 * and scheduled full-run failure reporter (issue #1505).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { VALIDATION_VARIANTS } from '../fixtures/validation_cache.ts';
import { launchWorker, RunTally, tallyFaults } from '../selftest.ts';

export const ROOT = resolve(import.meta.dir, '..');

/** Release PR title or release commit subject convention (retired release-please pattern + manual cut pattern). */
export const RELEASE_TITLE_RE = /^(?:chore(?:\([^)]+\))?: release|release:) v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?$/;

export type CiJobFlag = 'install-ubuntu' | 'expected-files' | 'painting-public' | 'standalone-tools';

export interface MapRule {
  readonly pattern: string;
  readonly tier?: 'full';
  readonly suites: readonly string[];
  readonly jobs?: readonly CiJobFlag[];
  readonly why: string;
}

/**
 * Complete path-to-suite and job map covering every tracked file in the repository.
 * Rules evaluate in order; any path not matched by a light-tier rule triggers the full release tier.
 */
export const PATH_TO_SUITE_MAP: readonly MapRule[] = [
  // 1. Full-tier triggers (workflows, CI tier map, release gates, smoke harnesses, bin shim, manifest, lockfile, shared validation builders)
  { pattern: '.github/workflows/**', tier: 'full', suites: ['ALL'], why: 'CI and release workflow definitions' },
  { pattern: 'scripts/ci_tier.ts', tier: 'full', suites: ['ALL'], why: 'CI tier planner and path-to-suite map' },
  { pattern: 'scripts/check_ci_tier.ts', tier: 'full', suites: ['ALL'], why: 'CI tier planner verification controls' },
  { pattern: 'scripts/tree-verdict.json', tier: 'full', suites: ['ALL'], why: 'tree-verdict lifecycle/2 coverage declaration' },
  { pattern: 'scripts/lint_workflows.declarations.json', tier: 'full', suites: ['ALL'], why: 'workflow verdict lint inventory' },
  { pattern: 'scripts/prepublish.cjs', tier: 'full', suites: ['ALL'], why: 'npm prepublishOnly gate entrypoint' },
  { pattern: 'scripts/alias_tarball.ts', tier: 'full', suites: ['ALL'], why: 'release alias tarball packer and comparator' },
  { pattern: 'scripts/install_smoke.ts', tier: 'full', suites: ['ALL'], why: 'cross-platform packed install smoke runner' },
  { pattern: 'scripts/smoke_process.ts', tier: 'full', suites: ['ALL'], why: 'install smoke child process harness' },
  { pattern: 'scripts/smoke_without_bun.ts', tier: 'full', suites: ['ALL'], why: 'Node-only bin shim smoke harness' },
  { pattern: 'scripts/check_smoke_process.ts', tier: 'full', suites: ['ALL'], why: 'smoke process harness controls' },
  { pattern: 'scripts/check_smoke_without_bun.ts', tier: 'full', suites: ['ALL'], why: 'Node-only smoke harness controls' },
  { pattern: 'bin/**', tier: 'full', suites: ['ALL'], why: 'shipped CLI binary shim' },
  { pattern: 'package.json', tier: 'full', suites: ['ALL'], why: 'package manifest (version, files, exports, bin, dependencies)' },
  { pattern: 'bun.lock', tier: 'full', suites: ['ALL'], why: 'dependency lockfile' },
  { pattern: 'tsconfig.json', tier: 'full', suites: ['ALL'], why: 'TypeScript compiler configuration' },
  { pattern: 'eslint.config.js', tier: 'full', suites: ['ALL'], why: 'ESLint rule configuration' },
  { pattern: 'fixtures/validation.ts', tier: 'full', suites: ['ALL'], why: 'shared validation sample builder used across shards' },
  { pattern: 'fixtures/validation_cache.ts', tier: 'full', suites: ['ALL'], why: 'shared validation cache producer used across shards' },
  { pattern: 'fixtures/validation_contract.ts', tier: 'full', suites: ['ALL'], why: 'shared validation contract assertions' },
  { pattern: 'fixtures/validation_rebuild.ts', tier: 'full', suites: ['ALL'], why: 'validation sample rebuild verification' },
  { pattern: 'fixtures/regenerate_validation.ts', tier: 'full', suites: ['ALL'], why: 'validation sample regenerator' },

  // 2. Root files, documentation, skills, assets, workflows, examples, scripts
  { pattern: '.gitignore', suites: ['tree'], why: 'read by TY00 ignorePatterns()' },
  { pattern: 'CLAUDE.md', suites: ['tree'], why: 'scanned by TY00–TY04, TY11–TY12, TY39, TY1327' },
  { pattern: 'AGENTS.md', suites: ['tree'], why: 'symlink to CLAUDE.md scanned by tree' },
  { pattern: 'CONTRIBUTING.md', suites: ['tree'], why: 'scanned by tree text rules' },
  { pattern: 'LICENSE', suites: ['tree'], why: 'scanned by tree text rules' },
  { pattern: 'NOTICE.md', suites: ['tree'], why: 'scanned by tree text rules' },
  { pattern: 'CHANGELOG.md', suites: ['tree'], why: 'scanned by TY11/TY12/TY18/TY39 in tree' },
  { pattern: 'README.md', suites: ['readme-loop', 'fetch-examples', 'tree'], why: 'read by check:readme, TY18/TY19/TY28, readme-loop, fetch-examples' },
  { pattern: 'RELEASING.md', suites: ['tree'], why: 'read by AL01, AL07, AL08 in tree suite' },
  { pattern: 'skills/**', suites: ['tree'], why: 'read by TY18, TY27, TY40 skill router audit' },
  { pattern: 'assets/**', suites: ['tree'], why: 'checked by TY00 tree walk classification' },
  { pattern: 'workflows/**', suites: ['comfy', 'tree'], why: 'workflows/seethrough.json read by comfy adapter controls' },
  { pattern: 'docs/AUTHORING.md', suites: ['tree'], why: 'held by TY16/TY18/TY20/TY21/TY23/TY27/TY28/TY29/TY40/TY817/TY823 in tree' },
  { pattern: 'docs/STABILITY.md', suites: ['tree'], why: 'held by TY13/TY14/TY1372/MSD10 in tree' },
  { pattern: 'docs/MIGRATION.md', suites: ['tree'], why: 'held by MSD10 in tree' },
  { pattern: 'docs/DEPTH.md', suites: ['depth-maps', 'tree'], why: 'depth workflow documentation' },
  { pattern: 'docs/CHECKS.md', suites: ['tree'], why: 'scanned by tree text and link rules' },
  { pattern: 'docs/PAINTING.md', suites: ['painting', 'tree'], why: 'painting requirements documentation' },
  { pattern: 'docs/evidence/**', suites: ['auto-mesh', 'tree'], why: 'read by tools/production_trial_stray.ts (auto-mesh) and scanned by tree' },
  { pattern: 'examples/**', suites: ['fetch-examples', 'inputs-examples', 'propose-corpus', 'assemble-examples', 'ground-examples', 'auto-mesh-examples', 'chain', 'readme-loop', 'corpus', 'tree'], jobs: ['expected-files', 'painting-public'], why: 'public examples and expected snapshots' },
  { pattern: 'scripts/fetch-examples.sh', suites: ['fetch-examples', 'inputs-examples', 'propose-corpus', 'assemble-examples', 'ground-examples', 'auto-mesh-examples', 'chain', 'readme-loop', 'corpus', 'tree'], jobs: ['expected-files', 'painting-public'], why: 'pins example inputs commit' },
  { pattern: 'scripts/example_inputs.ts', suites: ['fetch-examples', 'inputs-examples', 'propose-corpus', 'assemble-examples', 'ground-examples', 'auto-mesh-examples', 'chain', 'readme-loop', 'corpus', 'tree'], jobs: ['expected-files', 'painting-public'], why: 'validates pinned example input blobs' },
  { pattern: 'scripts/readme_policy.ts', suites: ['tree'], why: 'invoked by check:readme and runReadmePolicyChecks in tree' },
  { pattern: 'scripts/verify_nova.ts', suites: ['tree'], why: 'tested by runVerifyNovaChecks in tree' },
  { pattern: 'scripts/scene_parity.ts', suites: ['scene', 'tree'], why: 'imported by runSceneSuite' },
  { pattern: 'scripts/selftest_measure.ts', tier: 'full', suites: ['run-tally', 'tree'], why: 'tested by runMeasurementControls in run-tally and TY24–TY26 (requires full-tier merge)' },
  { pattern: 'scripts/selftest_prefixes.ts', tier: 'full', suites: ['run-tally', 'tree'], why: 'tested by tallyPrefixCase (RT14) in run-tally (requires full-tier merge)' },
  { pattern: 'scripts/rig_oracle.ts', suites: ['rig', 'tree'], why: 'rig oracle script' },
  { pattern: 'scripts/soft_occluder_probe.ts', suites: ['assemble', 'tree'], why: 'occluder probe script' },
  { pattern: 'scripts/strip_old_config.ts', suites: ['config', 'tree'], why: 'config helper script' },

  // 3. cli.ts and selftest.ts
  { pattern: 'cli.ts', suites: ['cli', 'tree'], why: 'CLI dispatcher and flag tables tested by cli and TY13/TY15/TY16/TY40 in tree' },
  { pattern: 'selftest.ts', suites: ['tree'], why: 'scanned by TY01/TY04/TY08/TY09/RT14; diff hunks in selftest.ts select the edited suite functions (or full if outside suite functions)' },

  // 4. src/ modules -> direct owning suite(s) + cross-stage rows approved in Phase B
  { pattern: 'src/raster/png.ts', suites: ['png', 'tree'], why: 'PNG codec owned by png suite' },
  { pattern: 'src/raster/components.ts', suites: ['raster-components', 'tree'], why: 'connected components owned by raster-components suite' },
  { pattern: 'src/raster/morph.ts', suites: ['raster-morph', 'tree'], why: 'morphology ops owned by raster-morph suite' },
  { pattern: 'src/raster/blur.ts', suites: ['raster-blur', 'tree'], why: 'Gaussian blur owned by raster-blur suite' },
  { pattern: 'src/raster/resize.ts', suites: ['raster-resize', 'tree'], why: 'Lanczos/bilinear resize owned by raster-resize suite' },
  { pattern: 'src/raster/warp.ts', suites: ['raster-warp', 'tree'], why: 'affine/perspective warp owned by raster-warp suite' },
  { pattern: 'src/raster/poly.ts', suites: ['raster-poly', 'tree'], why: 'polygon rasterizer owned by raster-poly suite' },
  { pattern: 'src/raster/composite.ts', suites: ['raster-composite', 'tree'], why: 'alpha compositing owned by raster-composite suite' },
  { pattern: 'src/raster/index.ts', suites: ['png', 'raster-components', 'raster-morph', 'raster-blur', 'raster-resize', 'raster-warp', 'raster-poly', 'raster-composite', 'tree'], why: 'raster barrel export' },
  { pattern: 'src/raster/types.ts', suites: ['png', 'raster-components', 'raster-morph', 'raster-blur', 'raster-resize', 'raster-warp', 'raster-poly', 'raster-composite', 'tree'], why: 'raster type declarations' },

  { pattern: 'src/comfy/**', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'ComfyUI adapter owned by comfy suite and standalone comfy checks' },
  { pattern: 'src/seethrough-transform.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'See-through pad/crop transform owned by comfy suite' },
  { pattern: 'src/plate.ts', suites: ['comfy', 'assemble', 'tree'], jobs: ['standalone-tools'], why: 'plate producer owned by comfy and assemble suites' },
  { pattern: 'src/platecomponents.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'classified plate components owned by comfy suite' },
  { pattern: 'src/matte.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'receipted matte reader owned by check_matte.ts and comfy suite' },
  { pattern: 'src/maskvalues.ts', suites: ['comfy', 'assemble', 'tree'], jobs: ['standalone-tools'], why: 'mask value validation' },
  { pattern: 'src/externalreceipt.ts', suites: ['cli', 'comfy', 'tree'], why: 'external receipt writer tested in cli suite' },
  { pattern: 'src/receiptproducer.ts', suites: ['editor-receipts', 'config', 'parts', 'tree'], why: 'receipt producer validation' },

  { pattern: 'src/layers.ts', suites: ['layers-wrapper', 'layers-psd', 'corpus', 'tree'], why: 'layer reader owned by layers-wrapper, layers-psd, corpus' },
  { pattern: 'src/tags.ts', suites: ['layers-wrapper', 'layers-psd', 'plausibility', 'tree'], why: 'tag vocabulary owned by layers-* and plausibility' },
  { pattern: 'src/sheet.ts', suites: ['sheet', 'tree'], why: 'contact sheet renderer owned by sheet suite' },
  { pattern: 'src/inputs.ts', suites: ['inputs', 'inputs-examples', 'tree'], why: 'inputs reader owned by inputs and inputs-examples' },
  { pattern: 'src/graphs.ts', suites: ['prompt', 'comfy', 'tree'], why: 'workflow graph builder owned by prompt and comfy' },
  { pattern: 'src/guide.ts', suites: ['tree', 'config-write'], why: 'guide reader owned by tree (TY16/TY17) and config-write' },
  { pattern: 'src/errors.ts', suites: ['tree', 'config'], why: 'PartsError and failLine owned by tree (TY16/TY17) and config' },
  { pattern: 'src/coords.ts', suites: ['tree', 'winding', 'contour'], why: 'cropToSpineY coordinate door owned by tree (TY07/TY1445), winding, contour' },
  { pattern: 'src/round.ts', suites: ['contour-wiring', 'auto-mesh', 'auto-motion', 'influence', 'tree'], why: 'deterministic rounding helper' },
  { pattern: 'src/length.ts', suites: ['tree', 'contour-wiring'], why: 'edgeLength owned by tree (TY15) and contour-wiring' },
  { pattern: 'src/pyfmt.ts', suites: ['propose', 'tree'], why: 'Python float formatter owned by propose' },
  { pattern: 'src/runstamp.ts', suites: ['rig', 'assemble', 'scene', 'tree'], jobs: ['standalone-tools'], why: 'rig-run/1 stamp writer/reader tested by check_run_clock.ts, rig, assemble, scene' },

  { pattern: 'src/config.ts', suites: ['config', 'config-write', 'depth-maps', 'tree'], why: 'config loader owned by config, TY14 in tree, and relocation in depth-maps' },
  { pattern: 'src/configrelocation.ts', suites: ['config', 'depth-maps', 'mesh-draft', 'editor-receipts', 'tree'], why: 'config relocation helper' },
  { pattern: 'src/configwrite.ts', suites: ['config-write', 'arm-split-upgrade', 'propose', 'tree'], why: 'config writer owned by config-write and arm-split-upgrade' },
  { pattern: 'src/cloth-targets.json', suites: ['tree', 'propose'], why: 'cloth targets JSON owned by check_cloth_targets in tree' },
  { pattern: 'src/clothconfig.ts', suites: ['propose', 'config', 'tree'], why: 'cloth recipe config parser' },
  { pattern: 'src/cloth.ts', suites: ['influence', 'propose', 'rig', 'tree'], why: 'cloth chain and weight generator' },

  { pattern: 'src/parts.ts', suites: ['parts', 'sheet', 'editor-receipts', 'part-sources', 'corpus', 'tree'], why: 'parts.json reader/writer owned by parts, sheet, editor-receipts, part-sources, corpus' },
  { pattern: 'src/partscheck.ts', suites: ['assemble', 'parts', 'tree'], why: 'check-parts diagnostics owned by assemble and parts' },
  { pattern: 'src/partsource.ts', suites: ['part-sources', 'tree'], why: 'part source provenance owned by part-sources' },
  { pattern: 'src/partvisibility.ts', suites: ['assemble', 'tree'], why: 'See-through visibility report owned by assemble' },
  { pattern: 'src/visibility.ts', suites: ['comfy', 'assemble', 'tree'], why: 'layer visibility record owned by comfy and assemble' },
  { pattern: 'src/provenance.ts', suites: ['assemble', 'hybrid-limb', 'assemble-examples', 'tree'], why: 'part pixel provenance owned by assemble, hybrid-limb, assemble-examples' },
  { pattern: 'src/assembly-reading.ts', suites: ['assemble', 'config', 'depth-maps', 'hybrid-limb', 'take-layers', 'tree'], why: 'assembly config digest binding' },

  { pattern: 'src/assemble.ts', suites: ['assemble', 'assemble-examples', 'ground-examples', 'subset-cover', 'foot-ownership', 'hybrid-limb', 'take-layers', 'plausibility', 'tree'], why: 'assemble stage owned by assemble and its sub-suites' },
  { pattern: 'src/authoredunit.ts', suites: ['layers-wrapper', 'assemble', 'tree'], why: 'authored unit depth grouping owned by layers-wrapper' },
  { pattern: 'src/alternatelayers.ts', suites: ['alternate-layers', 'take-layers', 'tree'], why: 'alternate cut/take layers owned by alternate-layers' },
  { pattern: 'src/baseanchor.ts', suites: ['alternate-layers', 'tree'], why: 'base anchor validation owned by alternate-layers' },
  { pattern: 'src/takelayers.ts', suites: ['take-layers', 'assemble', 'tree'], why: 'take-layers stage owned by take-layers' },
  { pattern: 'src/takeregion.ts', suites: ['take-layers', 'assemble', 'tree'], why: 'region take extraction owned by take-layers and assemble' },
  { pattern: 'src/takesource.ts', suites: ['take-layers', 'tree'], why: 'take source binding owned by take-layers' },
  { pattern: 'src/occluders.ts', suites: ['assemble', 'comfy', 'take-layers', 'tree'], why: 'occluder split logic owned by assemble, comfy, take-layers' },
  { pattern: 'src/occluderstage.ts', suites: ['build', 'assemble', 'tree'], why: 'build-time occluder stage helper' },
  { pattern: 'src/edgeresidual.ts', suites: ['assemble', 'tree'], why: 'edge residual measurement owned by assemble' },
  { pattern: 'src/edgesplit.ts', suites: ['assemble', 'config', 'tree'], jobs: ['standalone-tools'], why: 'hem edge split owned by fixtures/edge_split.ts and assemble' },
  { pattern: 'src/editedparts.ts', suites: ['editor-receipts', 'depth-maps', 'config', 'tree'], why: 'edited_parts reader owned by editor-receipts, depth-maps, config' },
  { pattern: 'src/editreceipt.ts', suites: ['editor-receipts', 'part-sources', 'assemble', 'scene', 'take-layers', 'tree'], why: 'edited part receipt writer' },
  { pattern: 'src/hiddenextent.ts', suites: ['config', 'assemble', 'tree'], why: 'hidden extent validation owned by config and assemble' },
  { pattern: 'src/limbownership.ts', suites: ['subset-cover', 'foot-ownership', 'tree'], why: 'limb ownership owned by subset-cover and foot-ownership' },
  { pattern: 'src/limbs.ts', suites: ['assemble', 'foot-ownership', 'subset-cover', 'alternate-tips', 'tree'], why: 'limb cut assembly owned by assemble, foot-ownership, subset-cover, alternate-tips' },
  { pattern: 'src/limblayout.ts', suites: ['limb-layout', 'limb-slots', 'config', 'tree'], why: 'limb layout validation owned by limb-layout and limb-slots' },
  { pattern: 'src/limbslots.ts', suites: ['limb-slots', 'limb-layout', 'tree'], why: 'limb slot draw order owned by limb-slots and limb-layout' },
  { pattern: 'src/painting-reference.ts', suites: ['parts', 'tree'], why: 'sealed painting reference sidecar owned by parts suite' },
  { pattern: 'src/paintingedges.ts', suites: ['assemble', 'ground-examples', 'config', 'tree'], jobs: ['painting-public'], why: 'painting edge allocation owned by assemble and ground-examples' },
  { pattern: 'src/paintingextension.ts', suites: ['assemble', 'tree'], why: 'painting extension owned by assemble' },
  { pattern: 'src/paintingowner.ts', suites: ['assemble', 'editor-receipts', 'tree'], jobs: ['painting-public'], why: 'painting pixel ownership owned by assemble and check_painting_public' },
  { pattern: 'src/projectrule.ts', suites: ['assemble', 'assemble-examples', 'tree'], why: 'projection rule helper' },
  { pattern: 'src/seamrule.ts', suites: ['assemble', 'config', 'tree'], why: 'seam rule selection' },
  { pattern: 'src/sourcecover.ts', suites: ['assemble', 'tree'], why: 'source cover validation owned by assemble' },
  { pattern: 'src/sourcestates.ts', suites: ['boundary-colour', 'assemble', 'tree'], why: 'source visibility states owned by boundary-colour and assemble' },
  { pattern: 'src/diffcomponents.ts', suites: ['assemble', 'assemble-examples', 'tree'], why: 'compare component diffing owned by assemble' },
  { pattern: 'src/diffdrafts.ts', suites: ['assemble', 'tree'], why: 'draft-to-draft assemble diff owned by assemble' },

  { pattern: 'src/propose.ts', suites: ['propose', 'propose-corpus', 'rig', 'config-write', 'arm-split-upgrade', 'plausibility', 'tree'], why: 'propose stage owned by propose, propose-corpus, rig (neck mode), config-write, arm-split-upgrade' },
  { pattern: 'src/bustlandmarks.ts', suites: ['propose', 'config', 'config-write', 'tree'], why: 'bust-landmarks owned by propose, config, config-write' },
  { pattern: 'src/headbox.ts', suites: ['propose', 'propose-corpus', 'inputs', 'inputs-examples', 'tree'], why: 'head crop box detection' },
  { pattern: 'src/headcroppreflight.ts', suites: ['propose', 'tree'], why: 'head crop preflight owned by propose' },
  { pattern: 'src/headframe.ts', suites: ['propose', 'tree'], why: 'head frame geometry owned by propose' },
  { pattern: 'src/keypoints.ts', suites: ['keypoints', 'painting', 'propose', 'propose-corpus', 'diagnostics', 'tree'], why: 'keypoints reader owned by keypoints, painting, propose, diagnostics' },
  { pattern: 'src/paintcheck.ts', suites: ['painting', 'tree'], why: 'painting preflight owned by painting suite' },
  { pattern: 'src/skeleton.ts', suites: ['skeleton', 'keypoints', 'painting', 'prompt', 'tree'], why: 'skeleton layout owned by skeleton, keypoints, painting, prompt' },
  { pattern: 'src/squeeze.ts', suites: ['propose', 'tree'], why: 'chest squeeze geometry owned by propose' },
  { pattern: 'src/structure.ts', suites: ['structure', 'diagnostics', 'contour-wiring', 'tree'], why: 'structural analysis owned by structure, diagnostics, contour-wiring' },
  { pattern: 'src/diagnostics.ts', suites: ['diagnostics', 'structure', 'tree'], why: 'diagnostic note emitter owned by diagnostics and structure' },
  { pattern: 'src/planted.ts', suites: ['diagnostics', 'tree'], why: 'planted diagnostics helper owned by diagnostics' },
  { pattern: 'src/neckdraft.ts', suites: ['layers-wrapper', 'rig', 'propose', 'tree'], why: 'sampled neck draft owned by layers-wrapper, rig, propose' },

  // Phase B addition: src/rig.ts and the turn sources also select `build` (catches #958 and #889)
  { pattern: 'src/rig.ts', suites: ['rig', 'build', 'mesh-draft', 'waist', 'chain-inherit', 'front-slot', 'limb-slots', 'limb-layout', 'hybrid-limb', 'arm-split-upgrade', 'alternate-tips', 'alternate-layers', 'tree'], why: 'rig compiler stage owned by rig, build, mesh-draft, and limb/slot suites' },
  { pattern: 'src/waist.ts', suites: ['waist', 'tree'], why: 'waist bone logic owned by waist suite' },
  { pattern: 'src/waistmesh.ts', suites: ['waist', 'tree'], why: 'waist mesh solver owned by waist suite' },
  { pattern: 'src/weights.ts', suites: ['rig', 'contour-wiring', 'winding', 'influence', 'waist', 'tree'], why: 'bone weight solver' },
  { pattern: 'src/localweights.ts', suites: ['contour-wiring', 'auto-mesh', 'rig', 'tree'], why: 'local field weight solver' },
  { pattern: 'src/heat.ts', suites: ['rig', 'tree'], why: 'bone heat weight solver owned by rig suite' },
  { pattern: 'src/mesh.ts', suites: ['rig', 'auto-mesh', 'winding', 'contour', 'contour-wiring', 'waist', 'tree'], why: 'lattice and contour mesh builder' },
  { pattern: 'src/explicitmesh.ts', suites: ['config', 'rig', 'tree'], why: 'explicit mesh reader owned by config and rig' },
  { pattern: 'src/meshdraft.ts', suites: ['mesh-draft', 'influence', 'auto-motion', 'readme-loop', 'arm-split-upgrade', 'editor-receipts', 'depth-maps', 'tree'], why: 'mesh-draft stage' },
  { pattern: 'src/meshstats.ts', suites: ['mesh-stats', 'config', 'tree'], why: 'mesh-stats triangle counter owned by mesh-stats' },
  { pattern: 'src/contour.ts', suites: ['contour', 'contour-wiring', 'auto-mesh', 'winding', 'mesh-draft', 'behind-seams', 'tree'], why: 'contour extraction and triangulation' },
  { pattern: 'src/automesh.ts', suites: ['auto-mesh', 'auto-mesh-examples', 'auto-motion', 'build-cost', 'winding', 'contour-wiring', 'tree'], why: 'automatic mesh reduction owned by auto-mesh, auto-mesh-examples, auto-motion, build-cost, winding' },
  { pattern: 'src/autoenvelope.ts', suites: ['auto-mesh', 'auto-motion', 'raster-resize', 'contour-wiring', 'retune', 'tree'], why: 'skinning envelope solver' },
  { pattern: 'src/automotion.ts', suites: ['auto-motion', 'auto-mesh', 'build-cost', 'tree'], why: 'automatic motion residual evaluation' },
  { pattern: 'src/autoamplitude.ts', suites: ['auto-motion', 'auto-mesh', 'build-cost', 'tree'], why: 'automatic motion amplitude tuning' },
  { pattern: 'src/autoreplay.ts', suites: ['auto-motion', 'tree'], why: 'auto-motion replay cache owned by auto-motion' },
  { pattern: 'src/motion.ts', suites: ['rig', 'auto-motion', 'structure', 'scene', 'waist', 'chain-inherit', 'front-slot', 'tree'], why: 'motion track generator' },
  { pattern: 'src/turn.ts', suites: ['rig', 'build', 'config', 'propose', 'tree'], why: '2.5D turn deformation compiler' },
  { pattern: 'src/turncoverage.ts', suites: ['rig', 'build', 'tree'], why: 'turn surface coverage owned by rig and build' },
  { pattern: 'src/turnfield.ts', suites: ['rig', 'build', 'tree'], why: 'turn displacement field owned by rig and build' },
  { pattern: 'src/turnoverlap.ts', suites: ['rig', 'build', 'tree'], why: 'turn overlap solver owned by rig and build' },
  { pattern: 'src/boundarydepth.ts', suites: ['rig', 'build', 'tree'], why: 'boundary depth solver owned by rig and build' },
  { pattern: 'src/depthmaps.ts', suites: ['depth-maps', 'rig', 'tree'], why: 'depth map reader owned by depth-maps and rig' },
  { pattern: 'src/depthsheets.ts', suites: ['depth-maps', 'layers-wrapper', 'rig', 'comfy', 'tree'], why: 'depth contact sheet generator owned by depth-maps, layers-wrapper, rig, comfy' },
  { pattern: 'src/depthworkflow.ts', suites: ['depth-maps', 'rig', 'tree'], why: 'depth-init / depth-apply workflow owned by depth-maps and rig' },
  { pattern: 'src/setfocus.ts', suites: ['alternate-tips', 'rig', 'config', 'parts', 'tree'], why: 'set focus metadata owned by alternate-tips' },

  { pattern: 'src/remesh-api.ts', suites: ['remesh', 'tree'], why: 'public Bun remesh API subpath (TY41 in tree, remesh suite)' },
  { pattern: 'src/remesh.ts', suites: ['remesh', 'retune', 'hybrid-limb', 'tree'], why: 'remesh stage owned by remesh and retune' },
  { pattern: 'src/remeshdelta.ts', suites: ['remesh', 'retune', 'tree'], why: 'remesh geometry delta helper' },
  { pattern: 'src/retune.ts', suites: ['retune', 'remesh', 'tree'], why: 'retune stage owned by retune and remesh' },

  { pattern: 'src/build.ts', suites: ['build', 'loop', 'tree'], why: 'build stage owned by build and loop' },
  { pattern: 'src/apng.ts', suites: ['loop', 'readme-loop', 'tree'], why: 'APNG encoder owned by loop suite' },
  { pattern: 'src/gif.ts', suites: ['loop', 'readme-loop', 'tree'], why: 'GIF encoder owned by loop suite' },
  { pattern: 'src/palette.ts', suites: ['loop', 'tree'], why: 'palette quantizer owned by loop suite' },

  { pattern: 'src/scene.ts', suites: ['scene', 'requirements', 'tree'], why: 'compose stage owned by scene and requirements' },
  { pattern: 'src/sceneclips.ts', suites: ['scene', 'tree'], why: 'named scene animation clips owned by scene' },
  { pattern: 'src/scenerepeat.ts', suites: ['scene', 'tree'], why: 'scene character idle repeat compiler owned by scene' },

  // Phase B addition: src/check.ts also selects `chain` (catches #1317 and #938)
  { pattern: 'src/check.ts', suites: ['check', 'chain', 'behind-seams', 'joint-contact', 'core-pointer', 'requirements', 'fixed-skeleton', 'setup-painting', 'boundary-colour', 'contour-wiring', 'retune', 'build', 'tree'], why: 'check stage, chain (CH04), sub-check suites, retune (RN09), and build (BU165/BU212)' },
  { pattern: 'src/checkrow.ts', suites: ['check', 'behind-seams', 'joint-contact', 'setup-painting', 'retune', 'tree'], why: 'check row builder (TY823/TY830/TY831 in tree)' },
  { pattern: 'src/behindseams.ts', suites: ['behind-seams', 'scene', 'tree'], why: 'BEHIND_PART_SEAMS owned by behind-seams and scene' },
  { pattern: 'src/boundarycolour.ts', suites: ['boundary-colour', 'scene', 'tree'], why: 'BOUNDARY_COLOUR owned by boundary-colour and scene' },
  { pattern: 'src/sourceexposure.ts', suites: ['boundary-colour', 'tree'], why: 'SOURCE_EXPOSURE owned by boundary-colour' },
  { pattern: 'src/artjoints.ts', suites: ['fixed-skeleton', 'tree'], why: 'fixed-skeleton art joints owned by fixed-skeleton' },
  { pattern: 'src/jointcontact.ts', suites: ['joint-contact', 'tree'], why: 'joint contact check owned by joint-contact' },
  { pattern: 'src/setuppainting.ts', suites: ['setup-painting', 'scene', 'assemble', 'take-layers', 'tree'], why: 'SETUP_MATCHES_PAINTING owned by setup-painting, scene, assemble, take-layers' },
  { pattern: 'src/setupbackdrop.ts', suites: ['setup-painting', 'tree'], why: 'setup backdrop exclusion owned by setup-painting' },
  { pattern: 'src/setupfiguremask.ts', suites: ['setup-painting', 'tree'], why: 'setup figure mask builder owned by setup-painting' },
  { pattern: 'src/requirements.ts', suites: ['requirements', 'behind-seams', 'fixed-skeleton', 'setup-painting', 'boundary-colour', 'assemble', 'tree'], why: 'requirements loader owned by requirements and bar suites' },
  { pattern: 'src/cutmaterial.ts', suites: ['requirements', 'parts', 'tree'], why: 'structural cut material check owned by requirements' },
  { pattern: 'src/cutmaterialio.ts', suites: ['requirements', 'parts', 'tree'], why: 'cut material I/O helper owned by requirements and parts' },
  { pattern: 'src/coincide.ts', suites: ['tree', 'build', 'check'], why: 'COINCIDE check owned by tree (runCoincideMutants), build, check' },
  { pattern: 'src/coincideio.ts', suites: ['tree', 'parts', 'check'], why: 'coincide I/O helper' },
  { pattern: 'src/instruments.ts', suites: ['parts', 'rig', 'propose', 'requirements', 'readme-loop', 'tree'], why: 'geometric and raster check instruments' },
  { pattern: 'src/motionseampose.ts', suites: ['tree', 'check'], why: 'posed motion-seam evaluation' },
  { pattern: 'src/motionseams.ts', suites: ['tree', 'check'], why: 'motion-seam corridor and band evaluation' },
  { pattern: 'src/outputpaths.ts', suites: ['check', 'scene', 'tree'], why: 'portable diagnostic output folder naming' },
  { pattern: 'src/physicscontrib.ts', suites: ['retune', 'check', 'tree'], why: 'PHYSICS_CONTRIBUTES check row owned by check and retune' },
  { pattern: 'src/supportdomains.ts', suites: ['check', 'parts', 'tree'], why: 'support domain check owned by check and parts' },

  // 5. tools/ files
  { pattern: 'tools/regenerate_examples.ts', suites: ['tree'], jobs: ['expected-files'], why: 'public examples expected-files builder/checker' },
  { pattern: 'tools/check_painting_public.ts', suites: ['assemble', 'tree'], jobs: ['painting-public'], why: 'public painting allocation membership check' },
  { pattern: 'tools/check_matte.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'standalone matte check in test job' },
  { pattern: 'tools/check_core_grid.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'standalone core plate grid check in test job' },
  { pattern: 'tools/check_core_cfg.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'standalone core plate --cfg check in test job' },
  { pattern: 'tools/check_run_clock.ts', suites: ['build', 'tree'], jobs: ['standalone-tools'], why: 'standalone run-stamp clock check in test job' },
  { pattern: 'tools/comfy_client.test.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'standalone ComfyUI client test in test job' },
  { pattern: 'tools/alternate-cli.ts', suites: ['cli', 'tree'], why: 'called by cli suite' },
  { pattern: 'tools/atlas_population.ts', suites: ['build', 'tree'], why: 'called by build suite' },
  { pattern: 'tools/build-process.ts', suites: ['build', 'config', 'tree'], why: 'shipped build child-process worker' },
  { pattern: 'tools/check_alternate_cut_layers.ts', suites: ['alternate-layers', 'tree'], why: 'called by alternate-layers suite' },
  { pattern: 'tools/check_alternate_layers.ts', suites: ['alternate-layers', 'tree'], why: 'called by alternate-layers suite' },
  { pattern: 'tools/check_alternate_tips.ts', suites: ['alternate-tips', 'tree'], why: 'called by alternate-tips suite' },
  { pattern: 'tools/check_arm_split_upgrade.ts', suites: ['arm-split-upgrade', 'tree'], why: 'called by arm-split-upgrade suite' },
  { pattern: 'tools/check_art_joints.ts', suites: ['fixed-skeleton', 'tree'], why: 'called by fixed-skeleton suite' },
  { pattern: 'tools/check_authored_unit_depth.ts', suites: ['layers-wrapper', 'tree'], why: 'called by layers-wrapper suite' },
  { pattern: 'tools/check_base_anchor.ts', suites: ['alternate-layers', 'tree'], why: 'called by alternate-layers suite' },
  { pattern: 'tools/check_behind_seams.ts', suites: ['behind-seams', 'tree'], why: 'called by behind-seams suite' },
  { pattern: 'tools/check_boundary_colour.ts', suites: ['boundary-colour', 'tree'], why: 'called by boundary-colour suite' },
  { pattern: 'tools/check_bust_landmarks.ts', suites: ['propose', 'tree'], why: 'called by propose suite' },
  { pattern: 'tools/check_bust_moved.ts', suites: ['propose', 'tree'], why: 'called by propose suite' },
  { pattern: 'tools/check_bust_shape.ts', suites: ['propose', 'tree'], why: 'called by propose suite' },
  { pattern: 'tools/check_cap_ownership.ts', suites: ['subset-cover', 'tree'], why: 'called by subset-cover suite' },
  { pattern: 'tools/check_chain_inherit.ts', suites: ['chain-inherit', 'tree'], why: 'called by chain-inherit suite' },
  { pattern: 'tools/check_classified_plate.ts', suites: ['comfy', 'tree'], why: 'called by comfy suite' },
  { pattern: 'tools/check_cloth_targets.ts', suites: ['tree'], why: 'called by tree suite' },
  { pattern: 'tools/check_coincide.ts', suites: ['tree', 'check'], why: 'called by tree and check suites' },
  { pattern: 'tools/check_configwrite.ts', suites: ['config-write', 'tree'], why: 'called by config-write suite' },
  { pattern: 'tools/configwrite.ts', suites: ['config-write', 'layers-wrapper', 'rig', 'propose', 'tree'], why: 'called by config-write, layers-wrapper, rig, propose' },
  { pattern: 'tools/check_corepointer.ts', suites: ['core-pointer', 'tree'], why: 'called by core-pointer suite' },
  { pattern: 'tools/check_cut_material.ts', suites: ['requirements', 'tree'], why: 'called by requirements suite' },
  { pattern: 'tools/check_depthmaps.ts', suites: ['depth-maps', 'tree'], why: 'called by depth-maps suite' },
  { pattern: 'tools/check_depthsheets.ts', suites: ['layers-wrapper', 'rig', 'comfy', 'tree'], why: 'called by layers-wrapper, rig, comfy' },
  { pattern: 'tools/check_diffcomponents.ts', suites: ['cli', 'assemble', 'assemble-examples', 'tree'], why: 'called by cli, assemble, assemble-examples' },
  { pattern: 'tools/check_diffdrafts.ts', suites: ['cli', 'assemble', 'tree'], why: 'called by cli and assemble' },
  { pattern: 'tools/check_edge_residual.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/check_edited_part_writer.ts', suites: ['editor-receipts', 'tree'], why: 'called by editor-receipts suite' },
  { pattern: 'tools/check_edited_parts.ts', suites: ['editor-receipts', 'depth-maps', 'config', 'tree'], why: 'called by editor-receipts, depth-maps, config' },
  { pattern: 'tools/check_editor_receipts.ts', suites: ['editor-receipts', 'tree'], why: 'called by editor-receipts suite' },
  { pattern: 'tools/check_explicitmesh.ts', suites: ['config', 'rig', 'tree'], why: 'called by config suite' },
  { pattern: 'tools/check_external_receipt.ts', suites: ['cli', 'tree'], why: 'called by cli suite' },
  { pattern: 'tools/check_extremes.ts', suites: ['check', 'tree'], why: 'called by check suite' },
  { pattern: 'tools/check_file_references.ts', suites: ['config', 'tree'], why: 'called by config suite' },
  { pattern: 'tools/check_foot_ownership.ts', suites: ['foot-ownership', 'tree'], why: 'called by foot-ownership suite' },
  { pattern: 'tools/check_front_slot.ts', suites: ['front-slot', 'tree'], why: 'called by front-slot suite' },
  { pattern: 'tools/check_gather_optout.ts', suites: ['limb-slots', 'tree'], why: 'called by limb-slots suite' },
  { pattern: 'tools/check_ground.ts', suites: ['config', 'assemble', 'ground-examples', 'tree'], why: 'called by config, assemble, ground-examples' },
  { pattern: 'tools/check_hybrid_limb.ts', suites: ['hybrid-limb', 'requirements', 'tree'], why: 'called by hybrid-limb and requirements' },
  { pattern: 'tools/check_joint_contact.ts', suites: ['joint-contact', 'tree'], why: 'called by joint-contact suite' },
  { pattern: 'tools/check_layer_bounds.ts', suites: ['layers-wrapper', 'tree'], why: 'called by layers-wrapper suite' },
  { pattern: 'tools/check_limb_layout.ts', suites: ['limb-layout', 'tree'], why: 'called by limb-layout suite' },
  { pattern: 'tools/check_limb_slots.ts', suites: ['limb-slots', 'tree'], why: 'called by limb-slots suite' },
  { pattern: 'tools/check_named_cut_skirt.ts', suites: ['propose', 'tree'], why: 'called by propose suite' },
  { pattern: 'tools/check_neck_bust.ts', suites: ['propose', 'tree'], why: 'called by propose suite' },
  { pattern: 'tools/check_neck_draft.ts', suites: ['layers-wrapper', 'rig', 'tree'], why: 'called by layers-wrapper and rig' },
  { pattern: 'tools/neck-propose.ts', suites: ['layers-wrapper', 'rig', 'propose', 'tree'], why: 'called by check_neck_draft and check_neck_bust' },
  { pattern: 'tools/check_occluders.ts', suites: ['assemble', 'comfy', 'tree'], why: 'called by assemble and comfy' },
  { pattern: 'tools/check_outline_specks.ts', suites: ['editor-receipts', 'tree'], why: 'called by editor-receipts suite' },
  { pattern: 'tools/check_painting_allocation.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/check_painting_edges.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/check_painting_extension.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/check_painting_extension_examples.ts', suites: ['assemble', 'tree'], why: 'painting extension example helper' },
  { pattern: 'tools/check_painting_outline.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/check_painting_owner.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/check_part_sources.ts', suites: ['part-sources', 'tree'], why: 'called by part-sources suite' },
  { pattern: 'tools/check_part_visibility.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/read_visibility_coverage.ts', suites: ['assemble', 'tree'], why: 'called by check_part_visibility in assemble' },
  { pattern: 'tools/check_pinholes.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/check_plate.ts', suites: ['comfy', 'tree'], why: 'called by comfy suite' },
  { pattern: 'tools/check_project_config.ts', suites: ['config', 'tree'], why: 'called by config suite' },
  { pattern: 'tools/check_requirements_named.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/check_revision_chain.ts', suites: ['config', 'remesh', 'retune', 'tree'], why: 'called by config, remesh, retune' },
  { pattern: 'tools/check_row_guard.ts', suites: ['tree', 'check'], why: 'called by tree and check' },
  { pattern: 'tools/check_row_reference.ts', suites: ['tree'], why: 'called by TY823 in tree suite' },
  { pattern: 'tools/check_row_scope.ts', suites: ['tree', 'check'], why: 'called by tree and check' },
  { pattern: 'tools/check_seam_cells.ts', suites: ['check', 'tree'], why: 'called by check suite' },
  { pattern: 'tools/check_seam_config.ts', suites: ['config', 'tree'], why: 'called by config suite' },
  { pattern: 'tools/check_seethrough_transform.ts', suites: ['comfy', 'tree'], why: 'called by comfy suite' },
  { pattern: 'tools/check_set_anchor.ts', suites: ['config', 'tree'], why: 'called by config suite' },
  { pattern: 'tools/check_set_focus.ts', suites: ['alternate-tips', 'tree'], why: 'called by alternate-tips suite' },
  { pattern: 'tools/check_setup_painting.ts', suites: ['setup-painting', 'tree'], why: 'called by setup-painting suite' },
  { pattern: 'tools/check_source_exposure.ts', suites: ['boundary-colour', 'tree'], why: 'called by boundary-colour suite' },
  { pattern: 'tools/check_subset_cap.ts', suites: ['subset-cover', 'tree'], why: 'called by subset-cover suite' },
  { pattern: 'tools/check_subset_cover.ts', suites: ['subset-cover', 'tree'], why: 'called by subset-cover suite' },
  { pattern: 'tools/check_support_domains.ts', suites: ['check', 'tree'], why: 'called by check suite' },
  { pattern: 'tools/check_take_cleanup.ts', suites: ['take-layers', 'tree'], why: 'called by take-layers suite' },
  { pattern: 'tools/check_take_footprint.ts', suites: ['take-layers', 'tree'], why: 'called by take-layers suite' },
  { pattern: 'tools/check_take_layers.ts', suites: ['take-layers', 'tree'], why: 'called by take-layers suite' },
  { pattern: 'tools/check_take_plan_order.ts', suites: ['take-layers', 'tree'], why: 'called by take-layers suite' },
  { pattern: 'tools/check_take_region.ts', suites: ['assemble', 'take-layers', 'tree'], why: 'called by assemble and take-layers' },
  { pattern: 'tools/observe_take_footprint.ts', suites: ['take-layers', 'tree'], why: 'called by check_take_footprint in take-layers' },
  { pattern: 'tools/check_turn_*.ts', suites: ['rig', 'build', 'tree'], why: 'turn control modules called by rig and build suites' },
  { pattern: 'tools/check_visibility.ts', suites: ['comfy', 'tree'], why: 'called by comfy suite' },
  { pattern: 'tools/check_waist*.ts', suites: ['waist', 'tree'], why: 'called by waist suite' },
  { pattern: 'tools/check_yield_contour.ts', suites: ['assemble', 'tree'], why: 'called by assemble suite' },
  { pattern: 'tools/expected_form.ts', suites: ['tree', 'chain'], why: 'called by tree and chain' },
  { pattern: 'tools/fixtures/**', suites: ['tree', 'check'], why: 'tools/fixtures/motion_seam_controls.ts called by tree and check' },
  { pattern: 'tools/parts_file_*.ts', suites: ['parts', 'tree'], why: 'parts.json field census and reference checks in parts suite' },
  { pattern: 'tools/parts_reader_fixture.ts', suites: ['parts', 'tree'], why: 'called by parts suite' },
  { pattern: 'tools/auto_*.ts', suites: ['auto-mesh', 'auto-motion', 'contour', 'contour-wiring', 'build-cost', 'tree'], why: 'auto-mesh and auto-motion survey helpers' },
  { pattern: 'tools/feature_contour_*.ts', suites: ['auto-mesh', 'tree'], why: 'called by auto-mesh suite' },
  { pattern: 'tools/production_trial*.ts', suites: ['auto-mesh', 'scene', 'tree'], why: 'called by auto-mesh and scene' },
  { pattern: 'tools/veto_tally.ts', suites: ['auto-motion', 'auto-mesh', 'raster-resize', 'contour-wiring', 'tree'], why: 'mesh reduction veto tally helper' },
  { pattern: 'tools/weight_rule_survey.ts', suites: ['auto-mesh', 'tree'], why: 'called by auto-mesh suite' },
  { pattern: 'tools/local_compare.ts', suites: ['depth-maps', 'contour-wiring', 'auto-mesh', 'build-cost', 'propose', 'assemble', 'scene', 'mesh-draft', 'tree'], why: 'local rig comparison helper' },
  { pattern: 'tools/real_compare.ts', suites: ['raster-morph', 'contour', 'contour-wiring', 'auto-mesh', 'build-cost', 'requirements', 'hybrid-limb', 'remesh', 'tree'], why: 'real rig comparison helper' },
  { pattern: 'tools/edited-part-cli.ts', suites: ['editor-receipts', 'cli', 'tree'], why: 'edited part CLI helper' },
  { pattern: 'tools/contourdraft.ts', suites: ['contour', 'contour-wiring', 'mesh-draft', 'tree'], why: 'contour draft helper' },
  { pattern: 'tools/compare_neck_origin.ts', suites: ['propose', 'rig', 'tree'], why: 'neck origin comparison helper' },
  { pattern: 'tools/hybrid_limb_*.ts', suites: ['hybrid-limb', 'requirements', 'tree'], why: 'hybrid limb acceptance and identity helpers' },
  { pattern: 'tools/idle_cost.ts', suites: ['build-cost', 'auto-motion', 'tree'], why: 'idle cost measurement helper' },
  { pattern: 'tools/measure_authored_unit_depth.ts', suites: ['layers-wrapper', 'assemble', 'tree'], why: 'authored unit depth measurement tool' },
  { pattern: 'tools/measure_edge_residual.ts', suites: ['assemble', 'tree'], why: 'edge residual measurement tool' },
  { pattern: 'tools/measure_take_region.ts', suites: ['take-layers', 'assemble', 'tree'], why: 'take region measurement tool' },
  { pattern: 'tools/measure_turn_*.ts', suites: ['rig', 'build', 'tree'], why: 'turn blend and unit precedence measurement tools' },
  { pattern: 'tools/{amplitude_survey,arm_seam_survey,back_hair_survey,bend_survey,cap_survey,case_clock_sample,cloth_*,compose_*,contour_*,cut_*,density_survey,depth_*,dial_*,edge_survey,eye_*,face_*,falloff_survey,foot_*,fringe_*,ground_*,hair_*,head_*,hem_*,island_draft_survey,joint_*,limb_*,loop_*,mesh_*,motion_*,neck_*,occluder_*,offfigure_survey,outfit_*,outline_survey,overlap_*,pack_*,painting_*,part_*,physics_*,pinhole_*,plate_*,pose_*,project_*,propose_*,reach_*,region_*,remesh_*,retune_*,rig_*,seam_*,set_*,setup_*,sheet_*,skirt_*,sleeve_*,slot_*,source_*,split_*,squeeze_*,strand_*,subset_*,support_*,take_*,tear_survey,tip_survey,torso_*,turn_*,under_*,waist_*,weight_*,wind_*,wrist_*,yield_*}.ts', suites: ['tree'], why: 'offline survey and measurement tools scanned by tree' },

  // 6. fixtures/ files
  { pattern: 'fixtures/validation-inputs/**', suites: ['chain', 'tree'], why: 'golden validation-inputs expected outputs checked by chain and TY22/expectedFormCases in tree' },
  { pattern: 'fixtures/edge_split.ts', suites: ['assemble', 'config', 'tree'], jobs: ['standalone-tools'], why: 'executed by bun test ./fixtures/edge_split.ts in test job' },
  { pattern: 'fixtures/alternate_cut_layers.ts', suites: ['assemble', 'alternate-layers', 'tree'], why: 'imported by assemble and alternate-layers' },
  { pattern: 'fixtures/alternate_layers.ts', suites: ['alternate-layers', 'take-layers', 'tree'], why: 'imported by alternate-layers and take-layers' },
  { pattern: 'fixtures/arm_split_upgrade.ts', suites: ['arm-split-upgrade', 'layers-wrapper', 'rig', 'propose', 'tree'], why: 'imported by arm-split-upgrade, layers-wrapper, rig, propose' },
  { pattern: 'fixtures/artist.ts', suites: ['cli', 'assemble', 'build', 'tree'], why: 'imported by cli, assemble, build' },
  { pattern: 'fixtures/authored_unit_depth.ts', suites: ['layers-wrapper', 'tree'], why: 'imported by check_authored_unit_depth in layers-wrapper' },
  { pattern: 'fixtures/bust.ts', suites: ['contour-wiring', 'tree'], why: 'imported by contour-wiring' },
  { pattern: 'fixtures/busy_ground.ts', suites: ['config', 'assemble', 'ground-examples', 'tree'], why: 'imported by check_ground in config, assemble, ground-examples' },
  { pattern: 'fixtures/chain_inherit.ts', suites: ['chain-inherit', 'tree'], why: 'imported by chain-inherit' },
  { pattern: 'fixtures/check_options.ts', suites: ['cli', 'build', 'tree'], why: 'imported by cli and build' },
  { pattern: 'fixtures/checkrig.ts', suites: ['behind-seams', 'requirements', 'fixed-skeleton', 'setup-painting', 'boundary-colour', 'check', 'tree'], why: 'check rig fixture helper' },
  { pattern: 'fixtures/classified_plate.ts', suites: ['comfy', 'tree'], why: 'imported by check_classified_plate in comfy' },
  { pattern: 'fixtures/cloth.ts', suites: ['config', 'config-write', 'rig', 'propose', 'influence', 'tree'], why: 'cloth fixture helper' },
  { pattern: 'fixtures/comfyharness.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'fake ComfyUI server harness' },
  { pattern: 'fixtures/configwrite.ts', suites: ['config-write', 'arm-split-upgrade', 'tree'], why: 'imported by config-write and arm-split-upgrade' },
  { pattern: 'fixtures/contour-turn.ts', suites: ['rig', 'build', 'tree'], why: 'imported by rig and build suites' },
  { pattern: 'fixtures/corepointer.ts', suites: ['core-pointer', 'tree'], why: 'imported by core-pointer suite' },
  { pattern: 'fixtures/crop_edge_checks.ts', suites: ['assemble', 'tree'], why: 'imported by assemble suite' },
  { pattern: 'fixtures/editor_receipts.ts', suites: ['editor-receipts', 'part-sources', 'depth-maps', 'config', 'rig', 'tree'], why: 'imported by editor-receipts, part-sources, depth-maps, config, rig' },
  { pattern: 'fixtures/explicitmesh.ts', suites: ['config', 'rig', 'tree'], why: 'imported by check_explicitmesh in config and rig' },
  { pattern: 'fixtures/fakecomfy.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'imported by comfy suite' },
  { pattern: 'fixtures/fakematte.ts', suites: ['comfy', 'tree'], jobs: ['standalone-tools'], why: 'imported by tools/check_matte.ts' },
  { pattern: 'fixtures/foot_ownership.ts', suites: ['foot-ownership', 'alternate-tips', 'alternate-layers', 'tree'], why: 'imported by foot-ownership, alternate-tips, alternate-layers' },
  { pattern: 'fixtures/front_slot.ts', suites: ['front-slot', 'assemble', 'tree'], why: 'imported by front-slot and assemble' },
  { pattern: 'fixtures/head_crop_preflight_checks.ts', suites: ['propose', 'tree'], why: 'imported by propose suite' },
  { pattern: 'fixtures/hidden_extent.ts', suites: ['config', 'assemble', 'tree'], why: 'imported by config and assemble' },
  { pattern: 'fixtures/hybrid_limb.ts', suites: ['hybrid-limb', 'requirements', 'tree'], why: 'imported by hybrid-limb and requirements' },
  { pattern: 'fixtures/limb_slots.ts', suites: ['limb-slots', 'limb-layout', 'tree'], why: 'imported by limb-slots and limb-layout' },
  { pattern: 'fixtures/mannequin.ts', suites: ['propose', 'tree'], why: 'imported by propose suite' },
  { pattern: 'fixtures/meshdraft.ts', suites: ['mesh-draft', 'influence', 'remesh', 'retune', 'config', 'tree'], why: 'imported by mesh-draft, influence, remesh, retune, config' },
  { pattern: 'fixtures/named_cut_skirt.ts', suites: ['propose', 'tree'], why: 'imported by check_named_cut_skirt in propose' },
  { pattern: 'fixtures/neck_draft.ts', suites: ['layers-wrapper', 'rig', 'propose', 'tree'], why: 'imported by check_neck_draft in layers-wrapper, rig, propose' },
  { pattern: 'fixtures/occluder_chain.ts', suites: ['assemble', 'take-layers', 'comfy', 'tree'], why: 'imported by assemble, take-layers, comfy' },
  { pattern: 'fixtures/painting*.ts', suites: ['painting', 'assemble', 'tree'], why: 'painting and painting-edge fixtures in painting and assemble' },
  { pattern: 'fixtures/painting_edge_*.json', suites: ['assemble', 'tree'], why: 'painting edge fixture JSONs read by check_painting_edges in assemble' },
  { pattern: 'fixtures/parts_check_checks.ts', suites: ['assemble', 'tree'], why: 'imported by assemble suite' },
  { pattern: 'fixtures/poses.ts', suites: ['propose', 'keypoints', 'diagnostics', 'tree'], why: 'imported by propose, keypoints, diagnostics' },
  { pattern: 'fixtures/propose.ts', suites: ['propose', 'keypoints', 'structure', 'diagnostics', 'influence', 'tree'], why: 'propose fixture builder' },
  { pattern: 'fixtures/reqrig.ts', suites: ['requirements', 'scene', 'tree'], why: 'requirements rig fixture builder' },
  { pattern: 'fixtures/rider.ts', suites: ['propose', 'check', 'tree'], why: 'rider fixture builder imported by propose and check' },
  { pattern: 'fixtures/rigc_run_clock*.ts', suites: ['build', 'comfy', 'tree'], jobs: ['standalone-tools'], why: 'imported by build, comfy, and tools/check_run_clock.ts' },
  { pattern: 'fixtures/scene.ts', suites: ['scene', 'tree'], why: 'imported by scene suite' },
  { pattern: 'fixtures/setupbackdrop.ts', suites: ['setup-painting', 'tree'], why: 'imported by setup-painting suite' },
  { pattern: 'fixtures/setupfigure.ts', suites: ['setup-painting', 'config', 'tree'], why: 'imported by setup-painting and config' },
  { pattern: 'fixtures/soft_occluder.ts', suites: ['assemble', 'tree'], why: 'imported by assemble suite' },
  { pattern: 'fixtures/source_cover_checks.ts', suites: ['assemble', 'tree'], why: 'imported by assemble suite' },
  { pattern: 'fixtures/squeeze.ts', suites: ['propose', 'check', 'tree'], why: 'imported by propose and check' },
  { pattern: 'fixtures/subset_cover.ts', suites: ['subset-cover', 'alternate-tips', 'alternate-layers', 'tree'], why: 'imported by subset-cover, alternate-tips, alternate-layers' },
  { pattern: 'fixtures/take_layers.ts', suites: ['take-layers', 'assemble', 'tree'], why: 'imported by take-layers and assemble' },
  { pattern: 'fixtures/take_region.ts', suites: ['take-layers', 'assemble', 'tree'], why: 'imported by take-layers and assemble' },
  { pattern: 'fixtures/turn_*.ts', suites: ['rig', 'build', 'scene', 'tree'], why: 'turn fixture builders imported by rig, build, and scene' },
  { pattern: 'fixtures/validation_ground.ts', suites: ['ground-examples', 'tree'], why: 'imported by ground-examples suite' },
  { pattern: 'fixtures/validation_hole.ts', suites: ['chain', 'tree'], why: 'imported by chain suite' },
  { pattern: 'fixtures/validation_metadata.ts', suites: ['structure', 'tree'], why: 'imported by structure suite' },
  { pattern: 'fixtures/validation_pinholes.ts', suites: ['assemble-examples', 'tree'], why: 'imported by assemble-examples suite' },
  { pattern: 'fixtures/validation_readers.ts', suites: ['propose-corpus', 'structure', 'inputs-examples', 'tree'], why: 'imported by propose-corpus, structure, inputs-examples' },
  { pattern: 'fixtures/waist.ts', suites: ['waist', 'tree'], why: 'imported by waist suite' },
  { pattern: 'fixtures/yield_contour.ts', suites: ['assemble', 'tree'], why: 'imported by check_yield_contour in assemble' },
  { pattern: 'fixtures/yield_rim.ts', suites: ['assemble', 'tree'], why: 'imported by assemble suite' },
  { pattern: 'fixtures/automesh.ts', suites: ['auto-mesh', 'auto-mesh-examples', 'auto-motion', 'build-cost', 'winding', 'contour', 'contour-wiring', 'tree'], why: 'auto-mesh fixture builder' },
  { pattern: 'fixtures/automotion.ts', suites: ['auto-motion', 'auto-mesh', 'auto-mesh-examples', 'build-cost', 'contour-wiring', 'tree'], why: 'auto-motion fixture builder' },
  { pattern: 'fixtures/contour.ts', suites: ['contour', 'contour-wiring', 'auto-mesh', 'auto-motion', 'build-cost', 'winding', 'behind-seams', 'loop', 'tree'], why: 'shared contour fixture builder' },
  { pattern: 'fixtures/localfield.ts', suites: ['contour-wiring', 'depth-maps', 'raster-morph', 'hybrid-limb', 'tree'], why: 'local field fixture builder' },
  { pattern: 'fixtures/assemble_fixture.ts', suites: ['assemble', 'assemble-examples', 'ground-examples', 'layers-wrapper', 'layers-psd', 'subset-cover', 'foot-ownership', 'hybrid-limb', 'take-layers', 'plausibility', 'tree'], why: 'synthetic assemble fixture builder' },
  { pattern: 'fixtures/rig.ts', suites: ['rig', 'waist', 'chain-inherit', 'front-slot', 'limb-slots', 'limb-layout', 'arm-split-upgrade', 'mesh-draft', 'mesh-stats', 'influence', 'remesh', 'retune', 'tree'], why: 'synthetic rig fixture builder' },
  { pattern: 'fixtures/structure.ts', suites: ['structure', 'keypoints', 'painting', 'plausibility', 'fetch-examples', 'prompt', 'tree'], why: 'synthetic structure fixture builder' },
  { pattern: 'fixtures/synthetic.ts', suites: ['layers-wrapper', 'layers-psd', 'inputs', 'plausibility', 'tree'], why: 'flat colour block synthetic fixture generator' },
  { pattern: 'fixtures/{oracle_assemble,project_band_controls,underpieces}.ts', suites: ['assemble', 'tree'], why: 'assemble fixture helpers' },
  { pattern: 'fixtures/reference-demo-auto-turn-1.79.1.config.json', suites: ['config', 'rig', 'tree'], why: 'reference-demo auto-turn config fixture' },
];

export function matchPathRule(file: string, map: readonly MapRule[] = PATH_TO_SUITE_MAP): MapRule | null {
  for (const rule of map) {
    if (new Bun.Glob(rule.pattern).match(file)) return rule;
  }
  return null;
}

export interface SelftestRegistry {
  readonly suites: ReadonlyArray<readonly [string, string]>;
  readonly allSuiteKeys: readonly string[];
  readonly startedFirst: readonly string[];
  readonly dispatchOrder: readonly string[];
  readonly shards: ReadonlyArray<readonly [string, readonly string[]]>;
  readonly suiteUnits: ReadonlyMap<string, readonly string[]>;
}

let cachedRegistry: SelftestRegistry | null = null;

export function readSelftestRegistry(selftestSource?: string): SelftestRegistry {
  if (selftestSource === undefined && cachedRegistry !== null) return cachedRegistry;
  const text = selftestSource ?? readFileSync(join(ROOT, 'selftest.ts'), 'utf8');
  const suitesBlock = /const SUITES: ReadonlyArray<readonly \[string, \(corpus: string \| null\) => number \| null\]> = \[([\s\S]*?)\];/.exec(text);
  if (suitesBlock === null) throw new Error('ci_tier: cannot find SUITES in selftest.ts');
  const suites: Array<readonly [string, string]> = [];
  for (const m of suitesBlock[1].matchAll(/\['([^']+)',\s*(\w+)\]/g)) {
    suites.push([m[1], m[2]]);
  }
  const startedBlock = /const STARTED_FIRST: readonly string\[\] = \[([\s\S]*?)\];/.exec(text);
  const startedFirst: string[] = [];
  if (startedBlock !== null) {
    for (const m of startedBlock[1].matchAll(/'([^']+)'/g)) startedFirst.push(m[1]);
  }
  const workerKeys = suites.map(([k]) => k);
  const dispatchOrder = [...startedFirst, ...workerKeys.filter((k) => !startedFirst.includes(k))];
  const allSuiteKeys = [...workerKeys, 'run-tally'];

  const shardsStart = text.indexOf('const SHARDS: ReadonlyArray<readonly [string, readonly string[]]> = [');
  if (shardsStart < 0) throw new Error('ci_tier: cannot find SHARDS in selftest.ts');
  const shardsEnd = text.indexOf('];', shardsStart);
  const shardsText = text.slice(shardsStart, shardsEnd);
  const shards: Array<readonly [string, readonly string[]]> = [];
  for (const m of shardsText.matchAll(/\['(\d+)',\s*\[([\s\S]*?)\]\]/g)) {
    const shardId = m[1];
    const units: string[] = [];
    for (const um of m[2].matchAll(/'([^']+)'/g)) {
      units.push(um[1]);
    }
    shards.push([shardId, units]);
  }

  // Canonical split-suite unit replay order from selftest.ts (suiteUnits(key, [])), never shard order.
  const valFeatMatch = /const VALIDATION_FEATURES\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(text);
  if (valFeatMatch === null) throw new Error('ci_tier: cannot find VALIDATION_FEATURES in selftest.ts');
  const valFeatures = [...valFeatMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const cl26Match = /const CL26_COMMAND_SETS:[\s\S]*?=\s*\[([\s\S]*?)\];/.exec(text);
  if (cl26Match === null) throw new Error('ci_tier: cannot find CL26_COMMAND_SETS in selftest.ts');
  const cl26Letters = [...cl26Match[1].matchAll(/\['([A-Z])',/g)].map((m) => m[1].toLowerCase());

  const cliStart = text.indexOf('function cliCaseGroups(): readonly CliCaseGroup[] {');
  if (cliStart < 0) throw new Error('ci_tier: cannot find cliCaseGroups in selftest.ts');
  const cliEnd = text.indexOf('\nfunction ', cliStart + 1);
  const cliBody = text.slice(cliStart, cliEnd < 0 ? text.length : cliEnd);
  const cliUnits: string[] = [];
  for (const m of cliBody.matchAll(/\['([a-z-]+)',\s*\(say\)\s*=>|\.\.\.CL26_COMMAND_SETS\.map\(/g)) {
    if (m[1] !== undefined) cliUnits.push(`cli@${m[1]}`);
    else for (const l of cl26Letters) cliUnits.push(`cli@usage-${l}`);
  }

  const checkStart = text.indexOf('function checkCaseGroups(): readonly CheckCaseGroup[] {');
  if (checkStart < 0) throw new Error('ci_tier: cannot find checkCaseGroups in selftest.ts');
  const checkEnd = text.indexOf('\nfunction ', checkStart + 1);
  const checkBody = text.slice(checkStart, checkEnd < 0 ? text.length : checkEnd);
  const checkUnits: string[] = [];
  for (const m of checkBody.matchAll(/\[(?:'([a-z-]+)'|(\w+)\.name),\s*\(_?scope/g)) {
    checkUnits.push(`check@${m[1] ?? m[2]}`);
  }

  const suiteUnits = new Map<string, readonly string[]>();
  for (const k of workerKeys) {
    if (k === 'chain') {
      suiteUnits.set(k, [...VALIDATION_VARIANTS, ...valFeatures.map((g) => `feature-${g}`), 'end'].map((p) => `chain@${p}`));
    } else if (k === 'readme-loop') {
      suiteUnits.set(k, ['loop-plain', 'loop-posed', 'loop-cloth', 'end'].map((p) => `readme-loop@${p}`));
    } else if (k === 'assemble-examples') {
      suiteUnits.set(k, ['standard', 'end'].map((p) => `assemble-examples@${p}`));
    } else if (k === 'check') {
      suiteUnits.set(k, checkUnits);
    } else if (k === 'cli') {
      suiteUnits.set(k, cliUnits);
    } else {
      suiteUnits.set(k, [k]);
    }
  }
  suiteUnits.set('run-tally', ['run-tally']);

  const shardUnitSet = new Set(shards.flatMap(([, units]) => units));
  const canonicalWorkerUnits = workerKeys.flatMap((k) => suiteUnits.get(k) ?? []);
  if (
    canonicalWorkerUnits.length !== shardUnitSet.size ||
    canonicalWorkerUnits.some((u) => !shardUnitSet.has(u))
  ) {
    throw new Error(
      `ci_tier: canonical suiteUnits (${canonicalWorkerUnits.length}) and SHARDS (${shardUnitSet.size}) disagree`,
    );
  }

  const reg: SelftestRegistry = { suites, allSuiteKeys, startedFirst, dispatchOrder, shards, suiteUnits };
  if (selftestSource === undefined) cachedRegistry = reg;
  return reg;
}

export interface SelftestFunctionIndex {
  readonly ranges: ReadonlyArray<{
    readonly name: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly suites: readonly string[];
  }>;
}

let cachedFnIndex: SelftestFunctionIndex | null = null;

function tokenizeIdentifiers(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/\b[A-Za-z_]\w*\b/g)) out.add(m[0]);
  return out;
}

export function buildSelftestFunctionIndex(selftestSource?: string): SelftestFunctionIndex {
  if (selftestSource === undefined && cachedFnIndex !== null) return cachedFnIndex;
  const text = selftestSource ?? readFileSync(join(ROOT, 'selftest.ts'), 'utf8');
  const reg = readSelftestRegistry(text);
  const sf = ts.createSourceFile('selftest.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const fnDefs: Array<{ name: string; startLine: number; endLine: number; bodyText: string }> = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
      const startLine = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
      const endLine = sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
      fnDefs.push({ name: stmt.name.text, startLine, endLine, bodyText: stmt.getText(sf) });
    }
  }

  const fnNames = new Set(fnDefs.map((f) => f.name));
  const suiteFnToKey = new Map<string, string>();
  for (const [key, fnName] of reg.suites) suiteFnToKey.set(fnName, key);
  suiteFnToKey.set('runTallySuite', 'run-tally');

  // Harness entry functions that are not owned by a single suite
  const harnessFns = new Set([
    'main',
    'preMain',
    'shardMain',
    'mergeMain',
    'reportRun',
    'workerMain',
    'launchWorker',
    'startWorkers',
    'shardFaults',
    'recordFaults',
    'parseShardRecord',
    'readRunArgs',
    'readOnlyList',
    'refuseArgs',
  ]);

  const calleesOf = new Map<string, string[]>();
  for (const f of fnDefs) {
    const ids = tokenizeIdentifiers(f.bodyText);
    const callees: string[] = [];
    for (const id of ids) {
      if (id !== f.name && fnNames.has(id)) callees.push(id);
    }
    calleesOf.set(f.name, callees);
  }

  // For each suite entry function, find all reachable local helper functions (excluding harnessFns)
  const fnToSuites = new Map<string, Set<string>>();
  for (const [suiteFn, suiteKey] of suiteFnToKey) {
    const visited = new Set<string>([suiteFn]);
    const queue = [suiteFn];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      let set = fnToSuites.get(cur);
      if (set === undefined) {
        set = new Set();
        fnToSuites.set(cur, set);
      }
      set.add(suiteKey);
      for (const next of calleesOf.get(cur) ?? []) {
        if (!visited.has(next) && !harnessFns.has(next) && !suiteFnToKey.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }

  const ranges = fnDefs.map((f) => ({
    name: f.name,
    startLine: f.startLine,
    endLine: f.endLine,
    suites: harnessFns.has(f.name) ? [] : [...(fnToSuites.get(f.name) ?? [])],
  }));

  const idx: SelftestFunctionIndex = { ranges };
  if (selftestSource === undefined) cachedFnIndex = idx;
  return idx;
}

/**
 * Parse unified diff hunks (`@@ -a,b +c,d @@`) for `selftest.ts` and resolve the edited lines
 * to the `run*Suite` functions they belong to. Any hunk outside a suite-owned function escalates to `full: true`.
 */
export function resolveSelftestDiffSuites(
  diffText: string,
  selftestSource?: string,
): { full: boolean; suites: string[]; reason?: string } {
  const hunks = [...diffText.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)];
  if (hunks.length === 0) {
    return { full: true, suites: [], reason: 'selftest.ts-no-hunks' };
  }
  const idx = buildSelftestFunctionIndex(selftestSource);
  const touched = new Set<string>(['tree']);
  for (const h of hunks) {
    const start = Number(h[1]);
    const count = h[2] === undefined ? 1 : Number(h[2]);
    const lines: number[] = count <= 0 ? [Math.max(1, start)] : Array.from({ length: count }, (_, i) => start + i);
    for (const line of lines) {
      const fn = idx.ranges.find((r) => line >= r.startLine && line <= r.endLine);
      if (fn === undefined || fn.suites.length === 0) {
        return {
          full: true,
          suites: [],
          reason: `selftest.ts:${line}${fn !== undefined ? ` (${fn.name})` : ' (top-level)'}`,
        };
      }
      if (fn.suites.includes('run-tally')) {
        return {
          full: true,
          suites: [],
          reason: `run-tally:selftest.ts:${line} (${fn.name})`,
        };
      }
      for (const s of fn.suites) touched.add(s);
    }
  }
  return { full: false, suites: [...touched] };
}

export interface PlanCiTierInput {
  readonly eventName: string;
  readonly dispatchTier?: string;
  readonly prTitle?: string;
  readonly commitSubject?: string;
  readonly changedFiles: readonly string[];
  readonly selftestDiff?: string;
  readonly selftestSource?: string;
  readonly map?: readonly MapRule[];
}

export interface CiTierPlan {
  readonly tier: 'light' | 'full';
  readonly reasons: readonly string[];
  readonly suites: readonly string[];
  readonly shardUnits: Readonly<Record<'1' | '2' | '3' | '4' | '5', readonly string[]>>;
  readonly runExpectedFiles: boolean;
  readonly runPaintingPublic: boolean;
  readonly runStandaloneTools: boolean;
  readonly runBuildPlatforms: boolean;
  readonly runFullInstalls: boolean;
  readonly installMatrix: {
    readonly include: ReadonlyArray<{ readonly os: string; readonly bun: string; readonly npm: string }>;
  };
  readonly requiredChecks: readonly ['test', 'installs'];
}

const LIGHT_INSTALL_MATRIX = {
  include: [{ os: 'ubuntu-latest', bun: 'latest', npm: 'bundled' }],
} as const;

const FULL_INSTALL_MATRIX = {
  include: [
    { os: 'ubuntu-latest', bun: 'latest', npm: 'bundled' },
    { os: 'macos-latest', bun: 'latest', npm: 'bundled' },
    { os: 'windows-latest', bun: 'latest', npm: 'bundled' },
    { os: 'ubuntu-latest', bun: 'latest', npm: 'release' },
  ],
} as const;

export function planCiTier(input: PlanCiTierInput): CiTierPlan {
  const reg = readSelftestRegistry(input.selftestSource);
  const map = input.map ?? PATH_TO_SUITE_MAP;
  const reasons: string[] = [];
  let isFull = false;

  if (input.eventName === 'schedule') {
    isFull = true;
    reasons.push('schedule');
  }
  if (input.eventName === 'workflow_dispatch' && (input.dispatchTier ?? 'full') !== 'light') {
    isFull = true;
    reasons.push('workflow_dispatch:full');
  }
  const title = (input.prTitle ?? '').trim();
  const subject = (input.commitSubject ?? '').trim();
  if ((title !== '' && RELEASE_TITLE_RE.test(title)) || (subject !== '' && RELEASE_TITLE_RE.test(subject))) {
    isFull = true;
    reasons.push('release-PR');
  }
  if (input.changedFiles.length === 0 && !isFull) {
    isFull = true;
    reasons.push('empty-diff');
  }

  const selectedSuites = new Set<string>(['tree']);
  const selectedJobs = new Set<CiJobFlag>(['install-ubuntu']);

  for (const file of input.changedFiles) {
    const rule = matchPathRule(file, map);
    if (rule === null) {
      isFull = true;
      reasons.push(`unmapped:${file}`);
      continue;
    }
    if (rule.suites.includes('run-tally')) {
      isFull = true;
      reasons.push(`run-tally:${file}`);
      continue;
    }
    if (rule.tier === 'full') {
      isFull = true;
      reasons.push(file);
      continue;
    }
    for (const s of rule.suites) selectedSuites.add(s);
    for (const j of rule.jobs ?? []) selectedJobs.add(j);
  }

  if (!isFull && input.changedFiles.includes('selftest.ts')) {
    if (input.selftestDiff !== undefined && input.selftestDiff.trim() !== '') {
      const resolved = resolveSelftestDiffSuites(input.selftestDiff, input.selftestSource);
      if (resolved.full || resolved.suites.includes('run-tally')) {
        isFull = true;
        reasons.push(resolved.reason ?? 'selftest.ts-outside-suite-fn');
      } else {
        for (const s of resolved.suites) selectedSuites.add(s);
      }
    } else if (input.changedFiles.length === 1) {
      isFull = true;
      reasons.push('selftest.ts-only');
    }
  }

  const orderedSuites = isFull
    ? [...reg.dispatchOrder, 'run-tally']
    : reg.dispatchOrder.filter((k) => selectedSuites.has(k));

  const suiteSet = new Set(orderedSuites);
  const shardUnits: Record<'1' | '2' | '3' | '4' | '5', readonly string[]> = {
    '1': [],
    '2': [],
    '3': [],
    '4': [],
    '5': [],
  };
  for (const [shardId, units] of reg.shards) {
    if (shardId === '1' || shardId === '2' || shardId === '3' || shardId === '4' || shardId === '5') {
      shardUnits[shardId] = isFull ? [...units] : units.filter((u) => suiteSet.has(u.split('@')[0]));
    }
  }

  return {
    tier: isFull ? 'full' : 'light',
    reasons,
    suites: orderedSuites,
    shardUnits,
    runExpectedFiles: isFull || selectedJobs.has('expected-files'),
    runPaintingPublic: isFull || selectedJobs.has('painting-public'),
    runStandaloneTools: isFull || selectedJobs.has('standalone-tools'),
    runBuildPlatforms: isFull,
    runFullInstalls: isFull,
    installMatrix: isFull ? FULL_INSTALL_MATRIX : LIGHT_INSTALL_MATRIX,
    requiredChecks: ['test', 'installs'],
  };
}

export interface ScheduledFailureJob {
  readonly name: string;
  readonly conclusion: string;
  readonly htmlUrl?: string;
  readonly failedSteps?: readonly string[];
}

export interface ScheduledFailureInput {
  readonly runId: number | string;
  readonly runUrl: string;
  readonly headSha: string;
  readonly lastGreenFullSha: string | null;
  readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  readonly failedJobs: readonly ScheduledFailureJob[];
}

export function buildScheduledFailureIssue(input: ScheduledFailureInput): { title: string; body: string } {
  if (input.failedJobs.length === 0) {
    throw new Error('ci_tier: buildScheduledFailureIssue requires at least one failing job');
  }
  if (!/^[a-f0-9]{7,40}$/i.test(input.headSha)) {
    throw new Error(`ci_tier: invalid headSha ${JSON.stringify(input.headSha)}`);
  }
  const shortHead = input.headSha.slice(0, 7);
  const shortBase = input.lastGreenFullSha !== null && /^[a-f0-9]{7,40}$/i.test(input.lastGreenFullSha)
    ? input.lastGreenFullSha.slice(0, 7)
    : null;
  const rangeText = shortBase !== null ? `${shortBase}...${shortHead}` : `${shortHead} (no prior green full run found)`;
  const fullRangeText = input.lastGreenFullSha !== null ? `${input.lastGreenFullSha}...${input.headSha}` : input.headSha;

  const title = `ci: scheduled full run failed on main (${shortHead})`;
  const jobLines = input.failedJobs.map((j) => {
    const stepsClause = j.failedSteps && j.failedSteps.length > 0 ? ` — step(s): ${j.failedSteps.map((s) => `\`${s}\``).join(', ')}` : '';
    const link = j.htmlUrl ? `[${j.name}](${j.htmlUrl})` : `\`${j.name}\``;
    return `- ${link} (\`${j.conclusion}\`)${stepsClause}`;
  });
  const commitLines = input.commits.length > 0
    ? input.commits.map((c) => `- \`${c.sha.slice(0, 7)}\` ${c.subject}`)
    : [`- \`${shortHead}\` (HEAD)`];

  const body = [
    `## Scheduled Daily Full CI Failure on \`main\``,
    ``,
    `- **Run:** [#${input.runId}](${input.runUrl})`,
    `- **HEAD SHA:** \`${input.headSha}\``,
    `- **Commit range since last green full run:** \`${rangeText}\` (\`${fullRangeText}\`)`,
    ``,
    `### Failing Jobs (${input.failedJobs.length})`,
    ...jobLines,
    ``,
    `### Commits in Range (\`${rangeText}\`)`,
    ...commitLines,
    ``,
  ].join('\n');

  return { title, body };
}

// ---------------------------------------------------------------------------
// Light-tier shard execution and merge (wraps selftest.ts without modifying it)
// ---------------------------------------------------------------------------

interface LightUnitRun {
  key: string;
  status: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  result: string | null;
  began: number;
  ended: number;
  measurement?: unknown;
}

interface LightShardRecord {
  spec: string;
  shard: string;
  jobs: number;
  cores: number;
  peakLine?: string;
  units: LightUnitRun[];
}

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return null;
  return argv[idx + 1];
}

function readSavedLightSuites(): string[] | null {
  const statePath = join(process.env.RUNNER_TEMP ?? tmpdir(), 'ci-tier-state.json');
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as { suites?: unknown };
    if (Array.isArray(parsed.suites) && parsed.suites.every((s): s is string => typeof s === 'string')) {
      return parsed.suites;
    }
  } catch {
    return null;
  }
  return null;
}

export async function runLightShard(shard: string, recordPath: string, selectedSuites: readonly string[]): Promise<number> {
  const reg = readSelftestRegistry();
  const shardDef = reg.shards.find(([n]) => n === shard);
  if (shardDef === undefined) {
    console.error(`ci_tier: unknown shard ${JSON.stringify(shard)}`);
    return 64;
  }
  const suiteSet = new Set(selectedSuites);
  const mine = shardDef[1].filter((u) => suiteSet.has(u.split('@')[0]));
  const jobs = Math.max(1, Math.min(2, Number(process.env.RIG_PARTS_SELFTEST_JOBS) || 2));
  const cores = availableParallelism();

  if (mine.length === 0) {
    mkdirSync(dirname(recordPath), { recursive: true });
    const emptyRecord: LightShardRecord = {
      spec: 'rig-parts-selftest-shard/2',
      shard,
      jobs,
      cores,
      peakLine: 'selftest peak (stderr, never tallied): self_max_rss_kib=0; family RSS unavailable',
      units: [],
    };
    writeFileSync(recordPath, `${JSON.stringify(emptyRecord)}\n`);
    process.stderr.write(`rig-parts selftest: light tier shard ${shard} — 0 selected units (fast exit)\n`);
    return 0;
  }

  const headGit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const headSha = (headGit.stdout ?? '').trim();
  const cacheDir = mkdtempSync(join(tmpdir(), 'rig-parts-light-cache-'));
  const resultsDir = mkdtempSync(join(tmpdir(), 'rig-parts-light-workers-'));
  process.env.RIG_PARTS_VALIDATION_CACHE = cacheDir;
  if (/^[a-f0-9]{40}$/.test(headSha)) process.env.RIG_PARTS_VALIDATION_HEAD = headSha;

  const clock = new Map<string, readonly [number, number]>();
  const doneMap = new Map<string, LightUnitRun>();
  const t0 = performance.now();
  let nextIdx = 0;

  const workerLane = async (): Promise<void> => {
    while (nextIdx < mine.length) {
      const unit = mine[nextIdx++];
      const began = performance.now() - t0;
      const run = await launchWorker(unit, null, resultsDir);
      const ended = performance.now() - t0;
      clock.set(unit, [began, ended]);
      doneMap.set(unit, { ...run, began, ended });
    }
  };

  try {
    const lanes: Array<Promise<void>> = [];
    for (let i = 0; i < Math.min(jobs, mine.length); i++) lanes.push(workerLane());
    await Promise.all(lanes);
  } finally {
    rmSync(resultsDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }

  const done: LightUnitRun[] = mine.map((u) => doneMap.get(u)!);
  for (const u of done) {
    process.stdout.write(u.stdout);
    if (u.stderr) process.stderr.write(u.stderr);
  }
  const wallSec = ((performance.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`rig-parts selftest: light tier shard ${shard} — ${done.length} unit(s) on ${jobs} worker(s) done in ${wallSec} s\n`);

  mkdirSync(dirname(recordPath), { recursive: true });
  const record: LightShardRecord = {
    spec: 'rig-parts-selftest-shard/2',
    shard,
    jobs,
    cores,
    peakLine: 'selftest peak (stderr, never tallied): self_max_rss_kib=0; family RSS unavailable',
    units: done,
  };
  writeFileSync(recordPath, `${JSON.stringify(record)}\n`);

  const red = done.filter((u) => {
    if (u.status !== 0 || u.result === null) return true;
    try {
      const r = JSON.parse(u.result) as { returned?: unknown; crash?: unknown };
      return typeof r.crash === 'string' || (typeof r.returned === 'number' && r.returned > 0);
    } catch {
      return true;
    }
  });
  if (red.length > 0) {
    console.error(`rig-parts selftest: light tier shard ${shard}: ${red.map((u) => u.key).join(', ')} did not run green`);
    return 1;
  }
  return 0;
}

export function mergeLightShards(dir: string, selectedSuites: readonly string[]): number {
  const reg = readSelftestRegistry();
  if (!existsSync(dir)) {
    console.error(`rig-parts selftest: --merge directory ${dir} does not exist`);
    return 2;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const records: LightShardRecord[] = [];
  for (const f of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8')) as LightShardRecord;
      if (typeof parsed?.shard === 'string' && Array.isArray(parsed?.units)) {
        records.push(parsed);
      } else {
        console.error(`rig-parts selftest: malformed shard record ${f}`);
        return 2;
      }
    } catch (error) {
      console.error(`rig-parts selftest: unreadable shard record ${f}: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
  }

  const faults: string[] = [];
  for (const [shardId] of reg.shards) {
    const count = records.filter((r) => r.shard === shardId).length;
    if (count !== 1) faults.push(`the shard "${shardId}" left ${count} record(s) (1 required)`);
  }

  const suiteSet = new Set(selectedSuites);
  if (suiteSet.has('run-tally')) {
    console.error('rig-parts selftest: light tier cannot run "run-tally" (paths mapping to run-tally must run the full tier)');
    return 2;
  }
  const expectedUnits = reg.shards.flatMap(([, units]) => units.filter((u) => suiteSet.has(u.split('@')[0])));
  const byUnit = new Map<string, LightUnitRun>();
  for (const r of records) {
    for (const u of r.units) {
      if (byUnit.has(u.key)) faults.push(`the unit "${u.key}" was recorded more than once`);
      byUnit.set(u.key, u);
    }
  }
  for (const u of expectedUnits) {
    if (!byUnit.has(u)) faults.push(`the selected unit "${u}" was recorded by no shard`);
  }
  if (faults.length > 0) {
    console.error('rig-parts selftest: light tier shard records are incomplete:');
    for (const f of faults) console.error(`  ${f}`);
    return 2;
  }

  const tally = new RunTally();
  const origLog = console.log;
  console.log = (...args: unknown[]): void => {
    const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
    tally.observe(line);
    origLog(...args);
  };

  const workerKeys = reg.suites.map(([k]) => k);
  const ranSuites: string[] = [];
  const skippedSuites: string[] = [];
  let unitFailures = 0;

  try {
    for (const key of workerKeys) {
      if (!suiteSet.has(key)) {
        skippedSuites.push(key);
        tally.of(key, () => {
          console.log(`\n── ${key} ──`);
          console.log(`  SKIP  ${key}: not run — --only`);
          return null;
        });
        continue;
      }
      const units = reg.suiteUnits.get(key) ?? [key];
      tally.of(key, () => {
        let suiteReturned = 0;
        let allNull = true;
        for (const u of units) {
          const run = byUnit.get(u);
          if (run === undefined) {
            console.log(`\n── ${key} ──`);
            console.log(`  FAIL  SUITE_CRASHED: worker "${u}" was not recorded`);
            unitFailures++;
            suiteReturned++;
            allNull = false;
            continue;
          }
          for (const line of run.stdout.split('\n')) {
            if (line !== '' || run.stdout.endsWith('\n')) {
              if (line !== '') console.log(line);
            }
          }
          if (run.stderr) process.stderr.write(run.stderr);
          if (run.status !== 0 || run.result === null) {
            console.log(`  FAIL  SUITE_CRASHED: worker "${u}" exited ${String(run.status)}`);
            unitFailures++;
            suiteReturned++;
            allNull = false;
            continue;
          }
          const parsed = JSON.parse(run.result) as { returned: number | null; crash?: string };
          if (typeof parsed.crash === 'string') {
            console.log(`  FAIL  SUITE_CRASHED: worker "${u}" threw ${parsed.crash}`);
            unitFailures++;
            suiteReturned++;
            allNull = false;
          } else if (parsed.returned !== null) {
            allNull = false;
            suiteReturned += parsed.returned;
          }
        }
        if (!allNull) ranSuites.push(key);
        return allNull ? null : suiteReturned;
      });
    }

    skippedSuites.push('run-tally');
    tally.of('run-tally', () => {
      console.log('\n── run-tally ──');
      console.log('  SKIP  run-tally: not run — --only');
      return null;
    });
  } finally {
    console.log = origLog;
  }

  const floorFaults = tallyFaults(tally.blocks, tally.gutter, tally.total);
  for (const key of selectedSuites) {
    if (key === 'corpus') continue;
    const block = tally.blocks.find((b) => b.key === key);
    if (block === undefined || !block.ran || block.controls === 0) {
      floorFaults.push(`the selected suite "${key}" printed 0 controls`);
    }
  }

  if (floorFaults.length > 0) {
    console.error('rig-parts selftest: light tier merge cannot account for itself:');
    for (const f of floorFaults) console.error(`  ${f}`);
    return 2;
  }
  if (tally.failures > 0 || unitFailures > 0) {
    console.error(`rig-parts selftest: ${Math.max(tally.failures, unitFailures)} control(s) failed`);
    return 1;
  }
  console.log(
    `rig-parts selftest: light tier green (--only) — ${ranSuites.length} suite(s) ran [${ranSuites.join(', ')}] over ${tally.total} case line(s); ${skippedSuites.length} suite(s) were not run.`,
  );
  return 0;
}

export function installLightBunShim(tier: string, suitesCsv: string, shimDir?: string): void {
  if (tier !== 'light') return;
  const tempBase = process.env.RUNNER_TEMP ?? tmpdir();
  const dir = shimDir ?? join(tempBase, 'ci-bin');
  mkdirSync(dir, { recursive: true });
  const suites = suitesCsv.split(',').map((s) => s.trim()).filter(Boolean);
  const statePath = join(tempBase, 'ci-tier-state.json');
  writeFileSync(statePath, JSON.stringify({ tier, suites }, null, 2) + '\n');

  const realBun = process.execPath;
  const scriptPath = join(ROOT, 'scripts', 'ci_tier.ts');
  const shimPath = join(dir, 'bun');
  const shim = [
    '#!/bin/sh',
    'if [ "$1" = "selftest.ts" ] && [ "$2" = "--shard" ]; then',
    `  exec '${realBun}' '${scriptPath}' run-light-shard "$@"`,
    'fi',
    'if [ "$1" = "selftest.ts" ] && [ "$2" = "--merge" ]; then',
    `  exec '${realBun}' '${scriptPath}' merge-light-shards "$@"`,
    'fi',
    `exec '${realBun}' "$@"`,
    '',
  ].join('\n');
  writeFileSync(shimPath, shim);
  chmodSync(shimPath, 0o755);
  if (process.env.GITHUB_PATH) {
    appendFileSync(process.env.GITHUB_PATH, `${dir}\n`);
  }
}

function readGitChangedFiles(baseRef: string, headRef: string): { files: string[]; selftestDiff: string; commitSubject: string } {
  const subj = spawnSync('git', ['log', '-1', '--format=%s', headRef || 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const commitSubject = (subj.stdout ?? '').trim();

  let range = '';
  if (baseRef && !/^0+$/.test(baseRef)) {
    const checkBase = spawnSync('git', ['cat-file', '-e', `${baseRef}^{commit}`], { cwd: ROOT });
    if (checkBase.status === 0) {
      range = `${baseRef}...${headRef || 'HEAD'}`;
    }
  }
  if (range === '') {
    const checkParent = spawnSync('git', ['cat-file', '-e', 'HEAD~1^{commit}'], { cwd: ROOT });
    if (checkParent.status === 0) range = 'HEAD~1..HEAD';
  }
  if (range === '') return { files: [], selftestDiff: '', commitSubject };

  const names = spawnSync('git', ['diff', '--name-only', range], { cwd: ROOT, encoding: 'utf8' });
  if (names.status !== 0) return { files: [], selftestDiff: '', commitSubject };
  const files = (names.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  let selftestDiff = '';
  if (files.includes('selftest.ts')) {
    const d = spawnSync('git', ['diff', '-U0', range, '--', 'selftest.ts'], { cwd: ROOT, encoding: 'utf8' });
    if (d.status === 0) selftestDiff = d.stdout ?? '';
  }
  return { files, selftestDiff, commitSubject };
}

function reportScheduledFailureFromEnv(): number {
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const runId = process.env.GITHUB_RUN_ID ?? '';
  const headSha = process.env.GITHUB_SHA ?? '';
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  if (!repo || !runId || !headSha) {
    console.error('ci_tier: report-scheduled-failure requires GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA');
    return 2;
  }
  const runUrl = `${serverUrl}/${repo}/actions/runs/${runId}`;

  const jobsRes = spawnSync('gh', ['api', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`], { cwd: ROOT, encoding: 'utf8' });
  if (jobsRes.status !== 0) {
    console.error(`ci_tier: gh api jobs failed: ${jobsRes.stderr ?? ''}`);
    return 1;
  }
  const jobsJson = JSON.parse(jobsRes.stdout) as {
    jobs?: Array<{
      name?: string;
      conclusion?: string | null;
      html_url?: string;
      steps?: Array<{ name?: string; conclusion?: string | null }>;
    }>;
  };
  const failedJobs: ScheduledFailureJob[] = (jobsJson.jobs ?? [])
    .filter((j) => j.name !== 'scheduled full run report' && (j.conclusion === 'failure' || j.conclusion === 'cancelled' || j.conclusion === 'timed_out'))
    .map((j) => ({
      name: j.name ?? 'unknown',
      conclusion: j.conclusion ?? 'failure',
      htmlUrl: j.html_url,
      failedSteps: (j.steps ?? []).filter((s) => s.conclusion === 'failure' || s.conclusion === 'cancelled' || s.conclusion === 'timed_out').map((s) => s.name ?? 'unnamed'),
    }));

  if (failedJobs.length === 0) {
    console.log('ci_tier: no failing jobs found in scheduled run');
    return 0;
  }

  // Find last green scheduled or workflow_dispatch or push full run on main
  let lastGreenFullSha: string | null = null;
  const runsRes = spawnSync('gh', ['api', `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&status=success&per_page=30`], { cwd: ROOT, encoding: 'utf8' });
  if (runsRes.status === 0) {
    try {
      const parsed = JSON.parse(runsRes.stdout) as { workflow_runs?: Array<{ id?: number; event?: string; head_sha?: string }> };
      const prior = (parsed.workflow_runs ?? []).find((r) => String(r.id) !== String(runId) && (r.event === 'schedule' || r.event === 'workflow_dispatch') && typeof r.head_sha === 'string');
      if (prior?.head_sha) lastGreenFullSha = prior.head_sha;
    } catch {
      lastGreenFullSha = null;
    }
  }

  const commits: Array<{ sha: string; subject: string }> = [];
  const logRange = lastGreenFullSha !== null ? `${lastGreenFullSha}..${headSha}` : `-n 10 ${headSha}`;
  const logArgs = lastGreenFullSha !== null ? ['log', '--format=%H %s', `${lastGreenFullSha}..${headSha}`] : ['log', '-n', '10', '--format=%H %s', headSha];
  const gitLog = spawnSync('git', logArgs, { cwd: ROOT, encoding: 'utf8' });
  if (gitLog.status === 0) {
    for (const line of (gitLog.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean)) {
      const sp = line.indexOf(' ');
      if (sp > 0) commits.push({ sha: line.slice(0, sp), subject: line.slice(sp + 1) });
    }
  }
  void logRange;

  const issue = buildScheduledFailureIssue({
    runId,
    runUrl,
    headSha,
    lastGreenFullSha,
    commits,
    failedJobs,
  });

  // Check if an open scheduled-run failure issue already exists
  const openRes = spawnSync('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--search', 'ci: scheduled full run failed on main in:title', '--json', 'number,title'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (openRes.status === 0) {
    try {
      const existing = JSON.parse(openRes.stdout) as Array<{ number?: number; title?: string }>;
      const match = existing.find((e) => typeof e.number === 'number' && (e.title ?? '').startsWith('ci: scheduled full run failed on main'));
      if (match?.number !== undefined) {
        const c = spawnSync('gh', ['issue', 'comment', String(match.number), '--repo', repo, '--body', issue.body], { cwd: ROOT, encoding: 'utf8' });
        if (c.status === 0) {
          console.log(`ci_tier: commented on existing scheduled failure issue #${match.number}`);
          return 0;
        }
      }
    } catch {
      // fall through to create
    }
  }

  const create = spawnSync('gh', ['issue', 'create', '--repo', repo, '--title', issue.title, '--body', issue.body], { cwd: ROOT, encoding: 'utf8' });
  if (create.status !== 0) {
    console.error(`ci_tier: gh issue create failed: ${create.stderr ?? ''}`);
    return 1;
  }
  console.log(`ci_tier: opened scheduled failure issue: ${(create.stdout ?? '').trim()}`);
  return 0;
}

if (import.meta.main) {
  const sub = process.argv[2] ?? 'plan';
  const rest = process.argv.slice(3);
  if (sub === 'plan') {
    const eventName = readFlagValue(rest, '--event') ?? process.env.EVENT_NAME ?? process.env.GITHUB_EVENT_NAME ?? 'pull_request';
    const dispatchTier = readFlagValue(rest, '--dispatch-tier') ?? process.env.DISPATCH_TIER ?? 'full';
    const prTitle = readFlagValue(rest, '--pr-title') ?? process.env.PR_TITLE ?? '';
    const baseRef = readFlagValue(rest, '--base') ?? process.env.BASE_SHA ?? '';
    const headRef = readFlagValue(rest, '--head') ?? process.env.HEAD_SHA ?? 'HEAD';
    const filesFlag = readFlagValue(rest, '--files');
    const gitInfo = filesFlag !== null
      ? { files: filesFlag.split(',').map((s) => s.trim()).filter(Boolean), selftestDiff: '', commitSubject: readFlagValue(rest, '--commit-subject') ?? '' }
      : readGitChangedFiles(baseRef, headRef);
    const commitSubject = readFlagValue(rest, '--commit-subject') ?? process.env.COMMIT_SUBJECT ?? gitInfo.commitSubject;

    const plan = planCiTier({
      eventName,
      dispatchTier,
      prTitle,
      commitSubject,
      changedFiles: gitInfo.files,
      selftestDiff: gitInfo.selftestDiff,
    });
    console.log(JSON.stringify(plan, null, 2));
    const outPath = readFlagValue(rest, '--github-output') ?? process.env.GITHUB_OUTPUT;
    if (outPath) {
      const lines = [
        `tier=${plan.tier}`,
        `suites=${plan.suites.join(',')}`,
        `run_expected_files=${plan.runExpectedFiles}`,
        `run_painting_public=${plan.runPaintingPublic}`,
        `run_standalone_tools=${plan.runStandaloneTools}`,
        `run_build_platforms=${plan.runBuildPlatforms}`,
        `run_full_installs=${plan.runFullInstalls}`,
        `install_matrix=${JSON.stringify(plan.installMatrix)}`,
      ];
      appendFileSync(outPath, `${lines.join('\n')}\n`);
    }
  } else if (sub === 'install-shim') {
    const tier = readFlagValue(rest, '--tier') ?? 'full';
    const suites = readFlagValue(rest, '--suites') ?? '';
    const dir = readFlagValue(rest, '--dir') ?? undefined;
    installLightBunShim(tier, suites, dir);
  } else if (sub === 'run-light-shard') {
    const shard = readFlagValue(rest, '--shard');
    const record = readFlagValue(rest, '--record');
    const suitesArg = readFlagValue(rest, '--suites');
    const suites = suitesArg !== null ? suitesArg.split(',').filter(Boolean) : readSavedLightSuites();
    if (shard === null || record === null || suites === null || suites.length === 0) {
      console.error('ci_tier: run-light-shard requires --shard <1..5> --record <file> and suites');
      process.exit(64);
    }
    const code = await runLightShard(shard, resolve(record), suites);
    process.exit(code);
  } else if (sub === 'merge-light-shards') {
    const dir = readFlagValue(rest, '--merge') ?? readFlagValue(rest, '--dir');
    const suitesArg = readFlagValue(rest, '--suites');
    const suites = suitesArg !== null ? suitesArg.split(',').filter(Boolean) : readSavedLightSuites();
    if (dir === null || suites === null || suites.length === 0) {
      console.error('ci_tier: merge-light-shards requires --merge <dir> and suites');
      process.exit(64);
    }
    const code = mergeLightShards(resolve(dir), suites);
    process.exit(code);
  } else if (sub === 'report-scheduled-failure') {
    process.exit(reportScheduledFailureFromEnv());
  } else {
    console.error(`ci_tier: unknown subcommand ${JSON.stringify(sub)}`);
    process.exit(64);
  }
}
