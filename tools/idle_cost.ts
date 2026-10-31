#!/usr/bin/env bun
/**
 * What a built rig's idle costs per frame, measured through spine-core
 * (rig-parts #13).
 *
 *     bun tools/idle_cost.ts [--seconds 10] [--fps 60] [--runs 5] [--json <file>] <label>=<build dir> ...
 *
 * Each `<build dir>` holds `skeleton.json` and `skeleton.atlas` as
 * `rigc build` writes them. For each one this prints:
 *
 * - **static**: bones (`skeleton.bones.length`, every one of which
 *   `updateWorldTransform` visits each frame), mesh attachments shown at the
 *   setup pose and their vertex total (`worldVerticesLength / 2`, the count
 *   `computeWorldVertices` writes), and the idle's timelines.
 * - **dynamic**: wall time per frame over `--runs` runs of `--seconds` at
 *   `--fps`, after one warm-up run of every build that is not counted. A frame
 *   is the calls `@rig-c/core/render` makes to pose one, minus
 *   rasterising: `state.update`, `state.apply`, `skeleton.update`,
 *   `updateWorldTransform(Physics.update)`, then `computeWorldVertices` for
 *   every mesh the draw order shows. The runs are interleaved — run 1 of every
 *   build, then run 2 of every build — so drift in the machine lands on all of
 *   them alike. Median and p95 are over every counted frame of every run; the
 *   per-run medians are printed too, so a noisy run is visible rather than
 *   averaged in.
 * - **renderer view**: per frame, how many shown meshes have ANY driving bone
 *   (the slot's bone and every bone its weights name — the set
 *   `A15_IDLE_NO_MESH_BONE_KEYS` reads) whose world transform (`a b c d
 *   worldX worldY`) differs from the previous frame, compared exactly. A mesh
 *   whose count is zero in a frame is one a dirty-skip renderer could skip;
 *   `skip-eligible` is meshes shown minus meshes moved.
 *
 * This is timing, so it is not a selftest control: its figures depend on the
 * machine. The load average is printed beside them for that reason. The
 * static and renderer-view figures do not depend on the machine.
 *
 * `@esotericsoftware/spine-core` is this repository's development dependency, pinned to
 * the version rig-c develops against (`TY10`); `tools/` is not in
 * `package.json` `files`, so nothing installed depends on this file.
 */
import { loadavg } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  MeshAttachment,
  Physics,
  Skeleton,
  type SkeletonData,
  SkeletonJson,
  TextureAtlas,
} from '@esotericsoftware/spine-core';

interface Build {
  label: string;
  dir: string;
  data: SkeletonData;
}

interface Static {
  bones: number;
  slots: number;
  meshAttachments: number;
  meshesShown: number;
  meshVertices: number;
  idleTimelines: number;
  idleBoneTimelines: number;
}

interface Renderer {
  frames: number;
  meshesShown: number;
  movedMin: number;
  movedMedian: number;
  movedMax: number;
  skipEligibleMax: number;
  bonesMovedMedian: number;
  bonesMovedMax: number;
}

interface Timing {
  frames: number;
  medianUs: number;
  p95Us: number;
  runMediansUs: number[];
  phaseMedianUs: { animation: number; world: number; vertices: number };
}

function usage(msg: string): never {
  console.log(`  FAIL  USAGE: ${msg}`);
  console.log('  bun tools/idle_cost.ts [--seconds S] [--fps F] [--runs R] [--json <file>] <label>=<build dir> ...');
  process.exit(2);
}

function load(label: string, dir: string): Build {
  const atlas = new TextureAtlas(readFileSync(join(dir, 'skeleton.atlas'), 'utf8'));
  const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(readFileSync(join(dir, 'skeleton.json'), 'utf8')));
  if (data.findAnimation('idle') === null) usage(`${label}: ${dir}/skeleton.json has no "idle" animation; it has [${data.animations.map((a) => a.name).join(', ')}]`);
  return { label, dir, data };
}

/** A posed skeleton playing the idle on a loop, at frame 0. */
function start(data: SkeletonData): { skeleton: Skeleton; state: AnimationState } {
  const skeleton = new Skeleton(data);
  const state = new AnimationState(new AnimationStateData(data));
  state.setAnimation(0, 'idle', true);
  skeleton.setupPose();
  state.apply(skeleton);
  skeleton.update(0);
  skeleton.updateWorldTransform(Physics.reset);
  return { skeleton, state };
}

/** The bone indices that drive a mesh: its slot's bone and every bone its weights name. */
function drivers(skeleton: Skeleton, slotIndex: number, mesh: MeshAttachment): number[] {
  const set = new Set<number>([skeleton.slots[slotIndex].bone.data.index]);
  const b = mesh.bones;
  if (b !== null) {
    for (let i = 0; i < b.length; ) {
      const n = b[i++];
      for (let k = 0; k < n; k++, i++) set.add(b[i]);
    }
  }
  return [...set].sort((x, y) => x - y);
}

function shownMeshes(skeleton: Skeleton): Array<{ slot: number; mesh: MeshAttachment }> {
  const out: Array<{ slot: number; mesh: MeshAttachment }> = [];
  for (const slot of skeleton.drawOrder.appliedPose) {
    const a = slot.appliedPose.attachment;
    if (a instanceof MeshAttachment) out.push({ slot: slot.data.index, mesh: a });
  }
  return out;
}

function staticCost(b: Build): Static {
  const { skeleton } = start(b.data);
  let meshAttachments = 0;
  for (const skin of b.data.skins) for (const e of skin.getAttachments()) if (e.attachment instanceof MeshAttachment) meshAttachments++;
  const shown = shownMeshes(skeleton);
  const idle = b.data.findAnimation('idle');
  const timelines = idle === null ? [] : idle.timelines;
  const boneTimelines = timelines.filter((t) => 'boneIndex' in t).length;
  return {
    bones: skeleton.bones.length,
    slots: skeleton.slots.length,
    meshAttachments,
    meshesShown: shown.length,
    meshVertices: shown.reduce((n, s) => n + s.mesh.worldVerticesLength / 2, 0),
    idleTimelines: timelines.length,
    idleBoneTimelines: boneTimelines,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
}

function snapshot(skeleton: Skeleton, into: Float64Array): void {
  const bones = skeleton.bones;
  for (let i = 0; i < bones.length; i++) {
    const p = bones[i].appliedPose;
    const o = i * 6;
    into[o] = p.a;
    into[o + 1] = p.b;
    into[o + 2] = p.c;
    into[o + 3] = p.d;
    into[o + 4] = p.worldX;
    into[o + 5] = p.worldY;
  }
}

function rendererView(b: Build, frames: number, fps: number): Renderer {
  const { skeleton, state } = start(b.data);
  const dt = 1 / fps;
  const n = skeleton.bones.length;
  let prev = new Float64Array(n * 6);
  let cur = new Float64Array(n * 6);
  snapshot(skeleton, prev);
  const moved: number[] = [];
  const bonesMoved: number[] = [];
  let shownCount = 0;
  let skipMax = 0;
  for (let f = 0; f < frames; f++) {
    state.update(dt);
    state.apply(skeleton);
    skeleton.update(dt);
    skeleton.updateWorldTransform(Physics.update);
    snapshot(skeleton, cur);
    const changed = new Uint8Array(n);
    let bm = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 6; k++) {
        if (cur[i * 6 + k] !== prev[i * 6 + k]) {
          changed[i] = 1;
          bm++;
          break;
        }
      }
    }
    const shown = shownMeshes(skeleton);
    shownCount = Math.max(shownCount, shown.length);
    let m = 0;
    for (const s of shown) if (drivers(skeleton, s.slot, s.mesh).some((i) => changed[i] === 1)) m++;
    moved.push(m);
    bonesMoved.push(bm);
    skipMax = Math.max(skipMax, shown.length - m);
    const t = prev;
    prev = cur;
    cur = t;
  }
  return {
    frames,
    meshesShown: shownCount,
    movedMin: Math.min(...moved),
    movedMedian: median(moved),
    movedMax: Math.max(...moved),
    skipEligibleMax: skipMax,
    bonesMovedMedian: median(bonesMoved),
    bonesMovedMax: Math.max(...bonesMoved),
  };
}

/** One timed run: `frames` frames of the idle, each timed whole and by phase, in microseconds. */
function timedRun(b: Build, frames: number, fps: number): { total: number[]; animation: number[]; world: number[]; vertices: number[] } {
  const { skeleton, state } = start(b.data);
  const dt = 1 / fps;
  const shown = shownMeshes(skeleton);
  const buffers = shown.map((s) => new Float32Array(s.mesh.worldVerticesLength));
  const total: number[] = new Array<number>(frames);
  const animation: number[] = new Array<number>(frames);
  const world: number[] = new Array<number>(frames);
  const vertices: number[] = new Array<number>(frames);
  for (let f = 0; f < frames; f++) {
    const t0 = Bun.nanoseconds();
    state.update(dt);
    state.apply(skeleton);
    skeleton.update(dt);
    const t1 = Bun.nanoseconds();
    skeleton.updateWorldTransform(Physics.update);
    const t2 = Bun.nanoseconds();
    const slots = skeleton.slots;
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      s.mesh.computeWorldVertices(skeleton, slots[s.slot], 0, s.mesh.worldVerticesLength, buffers[i], 0, 2);
    }
    const t3 = Bun.nanoseconds();
    total[f] = (t3 - t0) / 1000;
    animation[f] = (t1 - t0) / 1000;
    world[f] = (t2 - t1) / 1000;
    vertices[f] = (t3 - t2) / 1000;
  }
  return { total, animation, world, vertices };
}

function main(argv: string[]): void {
  let seconds = 10;
  let fps = 60;
  let runs = 5;
  let json: string | null = null;
  const builds: Build[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seconds' || a === '--fps' || a === '--runs' || a === '--json') {
      const v = argv[++i];
      if (v === undefined) usage(`${a} needs a value`);
      if (a === '--json') {
        json = v;
        continue;
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) usage(`${a} ${v}; a whole number >= 1 is required`);
      if (a === '--seconds') seconds = n;
      else if (a === '--fps') fps = n;
      else runs = n;
      continue;
    }
    const eq = a.indexOf('=');
    if (eq < 1) usage(`"${a}" is not <label>=<build dir>`);
    builds.push(load(a.slice(0, eq), a.slice(eq + 1)));
  }
  if (builds.length === 0) usage('at least one <label>=<build dir> is required');
  const frames = seconds * fps;
  const la = (): string => loadavg().map((x) => x.toFixed(2)).join(' ');
  console.log(`idle_cost: ${builds.length} build(s), ${runs} run(s) x ${frames} frame(s) (${seconds} s at ${fps} fps) each after one warm-up run, interleaved; load average before ${la()}`);

  const statics = builds.map(staticCost);
  const renderers = builds.map((b) => rendererView(b, frames, fps));
  for (const b of builds) timedRun(b, frames, fps);
  const samples = builds.map(() => ({ total: [] as number[], animation: [] as number[], world: [] as number[], vertices: [] as number[], runMedians: [] as number[] }));
  for (let r = 0; r < runs; r++) {
    builds.forEach((b, i) => {
      const t = timedRun(b, frames, fps);
      const s = samples[i];
      s.total.push(...t.total);
      s.animation.push(...t.animation);
      s.world.push(...t.world);
      s.vertices.push(...t.vertices);
      s.runMedians.push(median(t.total));
    });
  }
  const loadAfter = la();
  const timings: Timing[] = samples.map((s) => ({
    frames: s.total.length,
    medianUs: median(s.total),
    p95Us: quantile(s.total, 0.95),
    runMediansUs: s.runMedians,
    phaseMedianUs: { animation: median(s.animation), world: median(s.world), vertices: median(s.vertices) },
  }));
  const us = (x: number): string => x.toFixed(1);
  builds.forEach((b, i) => {
    const st = statics[i];
    const rv = renderers[i];
    const tm = timings[i];
    console.log(`${b.label}: ${b.dir}`);
    console.log(
      `  static: bones ${st.bones} slots ${st.slots} mesh attachments ${st.meshAttachments} (shown ${st.meshesShown}, ${st.meshVertices} vertices); idle timelines ${st.idleTimelines} (${st.idleBoneTimelines} bone)`,
    );
    console.log(
      `  renderer: ${rv.frames} frame(s), meshes shown ${rv.meshesShown}, moved per frame min ${rv.movedMin} median ${rv.movedMedian} max ${rv.movedMax}, skip-eligible per frame max ${rv.skipEligibleMax}; bones whose world transform changed per frame median ${rv.bonesMovedMedian} max ${rv.bonesMovedMax}`,
    );
    console.log(
      `  time: ${tm.frames} frame(s), per frame median ${us(tm.medianUs)} us p95 ${us(tm.p95Us)} us; phases (median) animation ${us(tm.phaseMedianUs.animation)} world ${us(tm.phaseMedianUs.world)} vertices ${us(tm.phaseMedianUs.vertices)} us; run medians ${tm.runMediansUs.map(us).join(' ')} us`,
    );
  });
  console.log(`idle_cost: load average after ${loadAfter}`);
  if (json !== null) {
    const out = builds.map((b, i) => ({ label: b.label, dir: b.dir, static: statics[i], renderer: renderers[i], time: timings[i] }));
    writeFileSync(json, `${JSON.stringify({ seconds, fps, runs, loadAfter, builds: out }, null, 1)}\n`);
  }
}

main(process.argv.slice(2));
