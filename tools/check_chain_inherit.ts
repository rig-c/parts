#!/usr/bin/env bun
/** Dedicated #369 controls, runnable before integration in the shared selftest.
 * bun tools/check_chain_inherit.ts [--keep <dir>]
 * Uses this install's gated rigc build and actual core-posed region corners.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chainInheritConfig, chainInheritImages, chainInheritParts, chainInheritProbe } from '../fixtures/chain_inherit.ts';
import { attachmentPoses, packageRigc } from '../src/check.ts';
import { parseConfig, parseProposalSections } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { withAnimations } from '../src/motion.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { buildRig, rigJsonText, OFFSET_PLACES, PAD, type RigOutput } from '../src/rig.ts';
import { RIG_BONE_INHERIT } from '@rig-c/core/rig';

const ROOT = resolve(import.meta.dir, '..');
/** Report every dedicated control through its caller's own tally. Throws on an execution failure. */
export function runChainInheritChecks(dir: string, check: (name: string, pass: boolean, detail: string) => void): void {
  mkdirSync(dir, { recursive: true });
  function build(config: Record<string, unknown>, keys: 'ctl' | 'direct' = 'ctl'): RigOutput {
    return buildRig(parseConfig(config), chainInheritParts(), chainInheritImages(), undefined, keys);
  }
  function texts(r: RigOutput): string[] {
    return [rigJsonText(r.rig), rigJsonText(r.motion), rigJsonText(r.meshReport), ...r.images.map(([name, image]) => `${name}:${Buffer.from(encodePngBytes(image)).toString('base64')}`)];
  }
  function refusal(value: unknown, code: string, field: string, required: string[] = [], proposal = false): boolean {
    const cfg = chainInheritConfig(value);
    try {
      if (proposal) parseProposalSections({ bones: cfg.bones, meshes: cfg.meshes, regions: cfg.regions, motion: cfg.motion });
      else parseConfig(cfg);
      return false;
    } catch (error) {
      return error instanceof PartsError && error.problems.some((p) => p.code === code && p.object.endsWith(field) && required.every((n) => p.detail.includes(n)));
    }
  }
  function run(args: string[]): void {
    const result = spawnSync(packageRigc(ROOT), args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (result.status !== 0) throw new Error(`rigc ${args.join(' ')}: exit ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  // Edge lengths and normalised corner dot products measure shape independently of translation/turn.
  function shape(vertices: readonly number[]): number[] {
    if (vertices.length !== 8) throw new Error(`region needs 4 corners; got ${vertices.length / 2}`);
    const edges = Array.from({ length: 4 }, (_, i) => {
      const j = (i + 1) % 4;
      return [vertices[2 * j] - vertices[2 * i], vertices[2 * j + 1] - vertices[2 * i + 1]];
    });
    const lengths = edges.map(([x, y]) => Math.hypot(x, y));
    return [...lengths, ...edges.map(([x, y], i) => {
      const [u, v] = edges[(i + 1) % 4];
      return (x * u + y * v) / (lengths[i] * lengths[(i + 1) % 4]);
    })];
  }
  // rig.ts OFFSET_PLACES states the written coordinate/degree quantum and that offsets
  // are placed through the written parent (world-position errors do not add by depth).
  // Allow a whole quantum per coordinate and degree across this fixed 128px canvas.
  // Comparing two frames' edges touches four points. Round that bound UP to a decimal
  // power, independently of the scaled candidate. The rigid-only control below first
  // checks that this serialization allowance also covers the actual renderer.
  const QUANTUM = 10 ** -OFFSET_PLACES;
  const EXTENT = Math.max(...chainInheritParts().rig_size);
  const POINT_ERROR = Math.SQRT2 * QUANTUM + EXTENT * QUANTUM * Math.PI / 180;
  const decimalCeiling = (n: number): number => 10 ** Math.ceil(Math.log10(n));
  const TOLERANCE = decimalCeiling(4 * POINT_ERROR); // 1e-4 rig px, derived before posing.
  const edges = chainInheritParts().parts.filter((p) => p.name !== 'probe').flatMap((p) => [p.w + 2 * PAD, p.h + 2 * PAD]);
  const MIN_EDGE = Math.min(...edges), MAX_EDGE = Math.max(...edges);
  const DOT_TOLERANCE = 4 * TOLERANCE / MIN_EDGE;
  const AREA_TOLERANCE = 2 * MAX_EDGE * TOLERANCE + TOLERANCE ** 2; // rig px squared.
  const ANGLE_TOLERANCE = decimalCeiling(Math.atan2(2 * POINT_ERROR, MIN_EDGE) * 180 / Math.PI);
  interface ShapeChange { length: number; dot: number; area: number }
  interface Measurement { shin: ShapeChange; shoe: ShapeChange; level: number; follows: number; travel: number }
  function area(v: readonly number[]): number {
    return Math.abs(v.reduce((sum, x, i) => i % 2 === 0 ? sum + x * v[(i + 3) % 8] - v[(i + 2) % 8] * v[i + 1] : sum, 0)) / 2;
  }
  function shapeHolds(s: ShapeChange): boolean {
    return s.length <= TOLERANCE && s.dot <= DOT_TOLERANCE && s.area <= AREA_TOLERANCE;
  }
  function measure(label: string, config: Record<string, unknown>, keys: 'ctl' | 'direct', thighScale = 0.8): Measurement {
    const r = build(config, keys);
    const out = join(dir, label);
    mkdirSync(join(out, 'images'), { recursive: true });
    for (const [name, image] of r.images) writeFileSync(join(out, 'images', name), encodePngBytes(image));
    writeFileSync(join(out, 'rig.json'), rigJsonText(r.rig));
    writeFileSync(join(out, 'motion.json'), rigJsonText(withAnimations(r.motion, chainInheritProbe(thighScale))));
    run(['build', '--rig', join(out, 'rig.json'), '--motion', join(out, 'motion.json'), '--out', join(out, 'build'), '--profile', 'rig-play', '--pack']);
    run(['render', '--candidate', join(out, 'build'), '--animation', 'probe', '--fps', '4', '--max', '128', '--geometry', '--out', join(out, 'render')]);
    const frameSet = JSON.parse(readFileSync(join(out, 'render', 'frames.json'), 'utf8')) as { sets: Array<{ animation: string; dir: string; written: number }> };
    const set = frameSet.sets.find((s) => s.animation === 'probe');
    if (set === undefined || set.written < 3) throw new Error('probe frame set absent or too short');
    const path = join(out, 'render', set.dir, 'geometry.json');
    const geometry = JSON.parse(readFileSync(path, 'utf8')) as { frames: Array<{ time: number; bones: Array<{ name: string; a: number; b: number; c: number; d: number; worldX: number; worldY: number }> }> };
    const frames = attachmentPoses(path, set.written);
    const start = geometry.frames.findIndex((f) => f.time === 0);
    const middle = geometry.frames.findIndex((f) => f.time === 0.5);
    if (start < 0 || middle < 0) throw new Error('geometry omitted probe times 0 and .5');
    const delta = (slot: string): ShapeChange => {
      const a = frames[start].get(slot), b = frames[middle].get(slot);
      if (a === undefined || b === undefined) throw new Error(`geometry omitted region ${slot}`);
      const before = shape(a.posed), after = shape(b.posed);
      return {
        length: Math.max(...before.slice(0, 4).map((x, i) => Math.abs(x - after[i]))),
        dot: Math.max(...before.slice(4).map((x, i) => Math.abs(x - after[i + 4]))),
        area: Math.abs(area(a.posed) - area(b.posed)),
      };
    };
    const foot = geometry.frames[middle].bones.find((b) => b.name === 'foot_r');
    if (foot === undefined) throw new Error('geometry omitted foot_r');
    let follows = 0, travel = Infinity;
    for (const [slot, bone] of [['shin', 'leg_r1'], ['shoe', 'foot_r']]) {
      const region = r.rig.skins.default[slot][slot];
      if ('type' in region) throw new Error(`${slot} must be a rigid region`);
      const origin = geometry.frames[start].bones.find((b) => b.name === bone);
      const moved = geometry.frames[middle].bones.find((b) => b.name === bone);
      if (origin === undefined || moved === undefined) throw new Error(`geometry omitted ${bone}`);
      travel = Math.min(travel, Math.hypot(moved.worldX - origin.worldX, moved.worldY - origin.worldY));
      for (const i of [start, middle]) {
        const transform = geometry.frames[i].bones.find((b) => b.name === bone);
        const plate = frames[i].get(slot);
        if (transform === undefined || plate === undefined) throw new Error(`geometry omitted ${slot}/${bone}`);
        const cx = (plate.posed[0] + plate.posed[2] + plate.posed[4] + plate.posed[6]) / 4;
        const cy = (plate.posed[1] + plate.posed[3] + plate.posed[5] + plate.posed[7]) / 4;
        // The plate's authored centre carried by its actual knee/ankle world frame.
        const x = transform.worldX + transform.a * region.x + transform.b * region.y;
        const y = transform.worldY + transform.c * region.x + transform.d * region.y;
        follows = Math.max(follows, Math.hypot(cx - x, cy - y));
      }
    }
    return { shin: delta('shin'), shoe: delta('shoe'), follows, travel, level: Math.abs(Math.atan2(foot.c, foot.a) * 180 / Math.PI) };
  }
  for (const mode of RIG_BONE_INHERIT) {
    for (const keys of ['ctl', 'direct'] as const) {
      const r = build(chainInheritConfig({ leg_r1: mode }), keys);
      const receiver = keys === 'ctl' ? 'leg_r1_ctl' : 'leg_r1';
      const target = r.rig.bones.find((b) => b.name === receiver);
      const child = r.rig.bones.find((b) => b.name === 'leg_r1');
      check(`CI_MODE_${mode}_${keys}`, target?.inherit === mode && (keys === 'direct' || child?.inherit === undefined), `${receiver} gets ${mode}; child does not duplicate the boundary`);
    }
  }
  for (const keys of ['ctl', 'direct'] as const) {
    const absent = texts(build(chainInheritConfig(), keys));
    const empty = texts(build(chainInheritConfig({}), keys));
    check(`CI_EMPTY_${keys}`, absent.length === empty.length && absent.every((v, i) => v === empty[i]), 'empty map and absent option have identical rig, motion, report and PNG bytes');
  }
  check('CI_NAME', refusal({ leg_l1: 'noScale' }, 'CONFIG_NAME_RESOLVES', '.link_inherit.leg_l1', ['leg_r0', 'leg_r1']), 'foreign link refused with this chain links');
  check('CI_INDEX', refusal({ 1: 'noScale' }, 'CONFIG_NAME_RESOLVES', '.link_inherit.1'), 'numeric index does not substitute for a named link');
  check('CI_CASE', refusal({ leg_r1: 'NoScale' }, 'CONFIG_BONE_INHERIT', '.link_inherit.leg_r1'), 'mode names are exact');
  for (const value of [null, [], 'noScale', 1]) check(`CI_MAP_${JSON.stringify(value)}`, refusal(value, 'CONFIG_FIELD_TYPE', '.link_inherit'), 'map must be an object');
  check('CI_VALUE', refusal({ leg_r1: 1 }, 'CONFIG_FIELD_TYPE', '.link_inherit.leg_r1'), 'map value must be a string');
  check('CI_PROPOSAL_NAME', refusal({ leg_l1: 'noScale' }, 'CONFIG_NAME_RESOLVES', '.link_inherit.leg_l1', ['leg_r0', 'leg_r1'], true), 'proposal parser uses same chain reference contract');
  for (const keys of ['ctl', 'direct'] as const) {
    const rigid = measure(`rigid-${keys}`, chainInheritConfig({ leg_r1: 'noScale' }, 'noScale', true), keys, 1);
    check(`CI_PRECISION_${keys}`, shapeHolds(rigid.shin) && shapeHolds(rigid.shoe) && rigid.follows <= TOLERANCE, `rigid-only representation control ${JSON.stringify(rigid)}; length ${TOLERANCE}px, dot ${DOT_TOLERANCE}, area ${AREA_TOLERANCE}px², angle ${ANGLE_TOLERANCE}deg; quantum ${QUANTUM}, extent ${EXTENT}`);
    const candidate = measure(`no-scale-${keys}`, chainInheritConfig({ leg_r1: 'noScale' }, 'noScale', true), keys);
    const legacy = measure(`legacy-${keys}`, chainInheritConfig(undefined, 'noRotationOrReflection'), keys);
    const noLevel = measure(`no-level-${keys}`, chainInheritConfig({ leg_r1: 'noScale' }, 'noScale'), keys);
    check(`CI_SHAPE_${keys}`, shapeHolds(candidate.shin) && shapeHolds(candidate.shoe), `actual region corners under thigh scale .8: ${JSON.stringify(candidate)}, tolerance ${TOLERANCE}`);
    check(`CI_FOLLOWS_${keys}`, candidate.follows <= TOLERANCE && candidate.travel > 1, `plate centres follow actual knee/ankle frames while both move: ${JSON.stringify(candidate)}`);
    check(`CI_LEGACY_${keys}`, !shapeHolds(legacy.shin) && !shapeHolds(legacy.shoe), `same posed scale exposes old shape change: ${JSON.stringify(legacy)}`);
    check(`CI_LEVEL_${keys}`, candidate.level <= ANGLE_TOLERANCE && noLevel.level > 1, `separate foot_level preserves rotation; without it ${JSON.stringify(noLevel)}`);
  }
}

if (import.meta.main) {
  const keep = process.argv.indexOf('--keep');
  const dir = keep < 0 ? mkdtempSync(join(tmpdir(), 'parts-chain-inherit-')) : resolve(process.argv[keep + 1]);
  let failed = 0;
  try {
    runChainInheritChecks(dir, (name, pass, detail) => {
      console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
      if (!pass) failed++;
    });
  } catch (error) {
    failed++;
    console.error(error);
  } finally {
    if (keep < 0) rmSync(dir, { recursive: true, force: true });
  }
  console.log(`CHAIN_INHERIT ${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failure(s)`);
  process.exitCode = failed === 0 ? 0 : 1;
}
