/**
 * `rig-parts mesh-draft` (issue #265, the gated half of the ruling of 2026-10-12): for every lattice mesh a config
 * states, a traced outline around a coarse grid — drafted only where it holds against that part's lattice, read
 * through rig-c. It reads a config and writes one; the config it reads is never touched.
 *
 * ## The candidate ({@link candidateMesh})
 *
 * A `contour` mesh with every number derived from the figure — H, the height of the union of every part's box in
 * rig px ({@link figureRules}) — and nothing read off the part:
 *
 * - the traced outline at tolerance and margin T = max(1, round(H / {@link TOLERANCE_FIGURE_DIVISOR}));
 * - no outline edge longer than the grid cell: `maxEdge` S (`src/contour.ts`, {@link capOutlineEdges});
 * - the interior grid at spacing S = round(H / {@link FIGURE_GRID_DIVISOR});
 * - dust left out: an extra 4-connected island of the art (alpha above `ART_ALPHA`) of at most {@link DUST_MAX_PX} px
 *   and at most {@link DUST_MAX_SHARE} of the part's art is dust, and a `stray` equal to the largest such island leaves
 *   it out. A part with any other extra island holds a real piece ({@link dustOf}): issue #326 drafts it per island,
 *   `bridges: true`, only when every island is carried by the same bones ({@link islandsJoin}: every vertex of the
 *   part's lattice bound to one bone, the same one); otherwise it keeps its lattice, and the note names the bones;
 * - `r`, `segments`, `exponent`, `rule` and `influences` as the lattice entry states them.
 *
 * The constants are the ones issue #265's stages measured (Stage A passed every bar at c = 37 on three examples; T 2
 * at the trailer's 1108 px figure is Stage A2's point; the dust rule is Stage B's). They are calibrated on three
 * figures of similar size (1106, 1108 and 1185 px), not laws of figure size, and every drafted mesh's note says so.
 *
 * ## The gate ({@link gateVerdict}), per part, against the lattice the part would otherwise keep
 *
 * 1. **bars**: every `check` bar that reads the part passes on the drafted rig (the rig stage's own gate included);
 *    a failing problem is laid on the parts it names ({@link partsNamed}).
 * 2. **idle**: within {@link IDLE_BOUND_PX} rig px of the lattice over the idle — rig-c's `MQ_LOCAL_DEFORMATION`,
 *    the lattice the reference, the idle as the motion gate walks it (`idleSchedule`, `src/automotion.ts`).
 * 3. **bend inverted**: at the bend set ({@link bendAnimations}: every chain link the part's segments name turned by
 *    +{@link BEND_DEGREES}° about its joint, then by −{@link BEND_DEGREES}°, Stage C's definition) no more inverted
 *    triangles than the lattice — rig-c's `MQ_INVERSION` (A39's band), summed over the two poses.
 * 4. **bend worst**: at the bend set, the worst sample within {@link BEND_WORST_SHARE} of the lattice's, both read as
 *    `MQ_LOCAL_DEFORMATION` against a reference denser than either: the same part as a lattice at the spacing Stage
 *    C's point reference sampled at ({@link denseGrid}), weighted by the same rule.
 * 5. **triangles**: no more triangles than the lattice (HQ's ruling on #295): a candidate that holds every motion
 *    line but costs more than the mesh it would replace is not drafted — unless the author passes
 *    {@link MORE_TRIANGLES_FLAG}, under which the count is reported (with the overdraw it buys) and is no line.
 *
 * The gate is a judgment relative to that lattice, not an absolute quality ({@link RELATIVE_SENTENCE}).
 *
 * The lattice is the config's own `grid` entry, which is what a part keeps when it fails. For a config whose meshes
 * came from `propose`, that is the lattice propose drafts — since #294 the figure's spacing, `round(H / 37)` with a
 * part already coarser keeping its own (`figureGrid`, `src/propose.ts`, whose divisor and rounding S also is).
 *
 * A part whose segments name no chain link has an empty bend set, and readings 3 and 4 have nothing to read; its
 * note says it was measured on the idle only. A part that passes all five is drafted; one that fails any keeps its
 * lattice entry byte for byte, and the report names each failed reading and by how much. Every reading with a number
 * carries its margin to the line ({@link GateLine.margin}), so a pass at the line reads as one.
 *
 * ## The one poser
 *
 * Every reading is rig-c's: the bars are `check`'s, through the injected {@link RigcRunner}; readings 2–4 are
 * `compareMeshesInMotion` (`rig-c/meshcompare`) over the model documents of three unpacked gate builds — the drafted
 * rig with every candidate part's attachment set to its lattice, to its candidate and to its dense reference, and
 * nothing else different — whose motion carries the bend animations. This module poses nothing.
 *
 * Pure in the sense `src/` is held to: no clock, no randomness, no network, no child process. rigc runs as a process,
 * but the process is injected, exactly as `src/check.ts` and `src/build.ts` take it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { AlphaMask, MeasureRow, MeshQualityReport, MotionSchedule } from 'rig-c/mesh';
import { compareMeshesInMotion, type MotionComparisonInput } from 'rig-c/meshcompare';
import { MeshReductionError } from 'rig-c/mesh';
import { explicitFrameId, idleSchedule } from './automotion.ts';
import { checkStage, gateThroughRigc, type Log, RIGC_MODEL_DOCUMENT, rigStage } from './build.ts';
import { BARS, type CheckReport, type PackShape, type PageEdges, type RigcRunner } from './check.ts';
import { type CharacterConfig, type ContourMeshSpec, type LatticeMeshSpec, loadConfigAndAnimations, type Segment } from './config.ts';
import { PartsError, type Problem, problemLine } from './errors.ts';
import { IDLE_FPS } from './motion.ts';
import { type ContourBridges, FAINT_ALPHA } from './contour.ts';
import { ART_ALPHA, DUST_MAX_PX, DUST_MAX_SHARE, isDust } from './mesh.ts';
import { type PartsFile, readParts } from './parts.ts';
import { alphaAbove, connectedComponents } from './raster/index.ts';
import { readPng } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import { buildRig, type IdleKeys, type MeshAttachment, rigJsonText, type RigSpec } from './rig.ts';
import { pyRound } from './round.ts';
import { FIGURE_GRID_DIVISOR, figureGrid } from './propose.ts';

/** The report's spec. */
export const MESH_DRAFT_SPEC = 'rig-parts-mesh-draft/1';

/** The report's file name, beside the drafted `config.json`. */
export const MESH_DRAFT_REPORT = 'mesh_draft.json';

/** T = max(1, round(H / 554)): T 2 at the trailer's 1108 px figure, Stage A2's measured point (issue #265). */
export const TOLERANCE_FIGURE_DIVISOR = 554;


/** The heights of the three figures the two divisors were measured on, rig px (demo, the trailer, scarf). */
export const CALIBRATION_HEIGHTS: readonly number[] = [1106, 1108, 1185];

/**
 * Dust (Stage B: 1–2 px dots were the measured case): `src/mesh.ts` holds the line since issue #303, which the rig
 * stage's heat refusal reads too; re-exported here, where it was first written.
 */
export { DUST_MAX_PX, DUST_MAX_SHARE } from './mesh.ts';

/** The bend set's turn per link, degrees: the fallback Stage C stated, a physics constraint's reach not being derivable from it. */
export const BEND_DEGREES = 15;

/** Reading 2's line: the candidate within this many rig px of the lattice over the idle. */
export const IDLE_BOUND_PX = 1;

/** Reading 4's line: the candidate's worst bend sample at most this share above the lattice's. */
export const BEND_WORST_SHARE = 0.1;

/** The dense reference's sample budget: Stage C's point reference took at most this many samples per part. */
export const DENSE_MAX_SAMPLES = 20000;

/** The author's flag that takes reading 5 off the gate: a candidate holding the four motion readings is drafted whatever its triangles. */
export const MORE_TRIANGLES_FLAG = '--more-triangles';

/**
 * What every note and the docs say of the gate's reference: the judgment is relative to the lattice the config states
 * — not an absolute quality — so when that lattice coarsens, the reference moves with it (on #295, moving demo,
 * scarf and the trailer from the part rule's lattice to the figure's flipped nine readings, with no candidate changed).
 */
export const RELATIVE_SENTENCE = 'the gate is a judgment relative to this config\'s lattice, not an absolute quality: when the lattice coarsens, the reference moves with it';

/**
 * What `mesh-draft` says of a part whose config entry is not a lattice (`contour` or `auto`, issue #307): it drafts
 * lattice entries only, so such a part was neither drafted nor compared. Said because the answer to "which mode comes
 * out smaller" is not the one the names suggest: on one figure (rig-c/trailer 45becfb) an `auto` reduction held to a
 * large declared bend kept two to three times the triangles of the outline this command drafts (AUTHORING §3, *Which
 * mode comes out smaller*).
 */
export const NOT_COMPARED_SENTENCE = 'mesh-draft drafts lattice entries only, so it drafted nothing for this part and compared it with nothing; whether a lattice, or the outline mesh-draft drafts over one, comes out smaller is not known from this run — build the part once on a lattice, run mesh-draft, and compare the rig stage\'s mesh lines before keeping this entry';

/** A config entry `mesh-draft` did not draft because it is not a lattice (issue #307), in config order. */
export interface NotCompared {
  part: string;
  mode: 'contour' | 'auto' | 'influence' | 'explicit';
  note: string;
}

/** The entries of `meshes` that are not lattices, in config order, each with its note ({@link NOT_COMPARED_SENTENCE}). */
export function notCompared(meshes: CharacterConfig['meshes']): NotCompared[] {
  const out: NotCompared[] = [];
  for (const [part, spec] of Object.entries(meshes)) {
    if ('grid' in spec) continue;
    const mode = 'explicit' in spec ? 'explicit' : 'auto' in spec ? 'auto' : 'influence' in spec ? 'influence' : 'contour';
    out.push({ part, mode, note: `its entry is "${mode}", not a lattice: ${NOT_COMPARED_SENTENCE}` });
  }
  return out;
}

/** The five readings, in the order the gate reads them. */
export const READINGS = ['bars', 'idle', 'bend inverted', 'bend worst', 'triangles'] as const;
export type Reading = (typeof READINGS)[number];

/** What every drafted mesh's note says it was and was not measured against. */
export const MEASURED_SENTENCE = `measured against the idle and the ${BEND_DEGREES}°-per-link bend set only — nothing larger was measured, so a chain an animation or a physics constraint bends further than that has not been read at that bend`;

/** What every drafted mesh's note says of the two rules. */
export const CALIBRATED_SENTENCE = `the spacing rule round(H / ${FIGURE_GRID_DIVISOR}) and the tolerance rule max(1, round(H / ${TOLERANCE_FIGURE_DIVISOR})) are calibrated on three figures of similar size (${CALIBRATION_HEIGHTS.join(', ')} px), not laws of figure size`;

// ---------------------------------------------------------------------------
// the figure's rules
// ---------------------------------------------------------------------------

export interface FigureRules {
  /** The union of every part's box, rig px. */
  top: number;
  bottom: number;
  height: number;
  /** T, the outline's tolerance and margin. */
  tolerance: number;
  /** S, the interior spacing and the outline's longest edge. */
  spacing: number;
}

/** H, T and S off parts.json's boxes, or the problem that refuses a figure the spacing rule gives no spacing for. */
export function figureRules(parts: Pick<PartsFile, 'parts'>): FigureRules | Problem {
  if (parts.parts.length === 0) return { code: 'MESH_DRAFT_FIGURE', object: 'parts.json', detail: 'holds no part, so the figure has no height; the rules are read off the union of the parts\' boxes' };
  const top = Math.min(...parts.parts.map((p) => p.y));
  const bottom = Math.max(...parts.parts.map((p) => p.y + p.h));
  const height = bottom - top;
  // S is propose's figure spacing (issue #265 half 1), the one definition of the rule: its divisor and its rounding.
  const spacing = figureGrid(parts.parts).grid;
  const tolerance = Math.max(1, Math.round(height / TOLERANCE_FIGURE_DIVISOR));
  if (spacing < 1) {
    return {
      code: 'MESH_DRAFT_FIGURE',
      object: `the figure, rows ${top} to ${bottom} rig px`,
      detail: `is ${height} px tall, so the spacing rule round(H / ${FIGURE_GRID_DIVISOR}) gives ${spacing}; a spacing of at least 1 px is required, and nothing is raised to reach it — the rule is calibrated on figures of ${CALIBRATION_HEIGHTS.join(', ')} px`,
    };
  }
  return { top, bottom, height, tolerance, spacing };
}

// ---------------------------------------------------------------------------
// the candidate
// ---------------------------------------------------------------------------

/** A part's art islands, largest first, and what the dust rule makes of them. */
export type DustReading = { stray: number | undefined; islands: number[]; dust: number[] } | { keep: string; islands: number[] };

/**
 * The dust rule on a part image (its alpha, unpadded or padded alike: the pad adds no art): the 4-connected islands
 * of alpha above `ART_ALPHA` — the contour mode's own island rule — and whether every island past the largest is
 * dust ({@link DUST_MAX_PX}, {@link DUST_MAX_SHARE}). A tie for the largest is no single largest island, which the
 * contour mode refuses, so it keeps the lattice too.
 */
export function dustOf(image: Raster): DustReading {
  const comp = connectedComponents(alphaAbove(image, ART_ALPHA), 4);
  const islands = comp.stats.slice(1).map((s) => s.area).sort((a, b) => b - a);
  const art = islands.reduce((a, b) => a + b, 0);
  if (islands.length === 0) return { keep: `its image has no pixel with alpha above ${ART_ALPHA}`, islands };
  if (islands.length > 1 && islands[0] === islands[1]) return { keep: `its art is ${islands.length} islands (${islands.join(', ')} px) of which two share the largest count, so no one island is the largest`, islands };
  const extra = islands.slice(1);
  const pieces = extra.filter((n) => !isDust(n, art));
  if (pieces.length > 0) {
    return {
      keep: `its art is ${islands.length} islands (${islands.join(', ')} px); ${pieces.length} beside the largest ${pieces.length === 1 ? 'is a real piece' : 'are real pieces'}, not dust (at most ${DUST_MAX_PX} px and at most ${pyRound(DUST_MAX_SHARE * 100, 6)} % of the part's ${art} art px), and the contour mode meshes one island`,
      islands,
    };
  }
  return { stray: extra.length === 0 ? undefined : extra[0], islands, dust: extra };
}

/**
 * The candidate for one lattice entry: the outline mesh at the figure's numbers, its weights' fields as the lattice
 * states them. `bridges` (issue #326): every real island meshed and joined by bridges ({@link islandsJoin}).
 */
export function candidateMesh(lattice: LatticeMeshSpec, rules: Pick<FigureRules, 'tolerance' | 'spacing'>, stray: number | undefined, bridges = false): ContourMeshSpec {
  return {
    contour: { tolerance: rules.tolerance, margin: rules.tolerance, spacing: rules.spacing, maxEdge: rules.spacing, ...(stray === undefined ? {} : { stray }), ...(bridges ? { bridges: true as const } : {}) },
    r: lattice.r,
    segments: lattice.segments,
    ...(lattice.exponent === undefined ? {} : { exponent: lattice.exponent }),
    ...(lattice.rule === undefined ? {} : { rule: lattice.rule }),
    ...(lattice.influences === undefined ? {} : { influences: lattice.influences }),
  };
}

/** What the same-bones test reads off a part's lattice as the rig stage weighted it (issue #326). */
export interface CarriedBy {
  /** Every bone a vertex is bound to, sorted. */
  bones: string[];
  /** The lattice's vertices, and how many are bound to more than one bone. */
  vertices: number;
  blended: number;
}

/** The bones a mesh attachment's vertices are bound to ({@link CarriedBy}). */
export function carriedBy(att: Pick<MeshAttachment, 'weights'>): CarriedBy {
  const bones = new Set<string>();
  let blended = 0;
  for (const w of att.weights) {
    for (const e of w) bones.add(e.bone);
    if (w.length > 1) blended++;
  }
  return { bones: [...bones].sort(), vertices: att.weights.length, blended };
}

/**
 * Issue #326 (HQ's ruling on Stage A): a part whose art holds a second real island is drafted per island, joined by
 * bridges, **only when every island is carried by the same bones**. The test, read off the part's lattice as the rig
 * stage weighted it ({@link carriedBy}): every vertex is bound to one bone, and it is the same bone for every
 * vertex. Then every point of the part — each island and every bridge between them — moves with that one bone, so no
 * island moves against another and no bridge stretches. Anything else keeps the lattice, and the sentence says which
 * bones; no two-bone join is drafted, measured or not (the ruling: nothing measured needs it).
 *
 * `islands` is {@link dustOf}'s reading of the same image. Returns the `stray` the candidate declares (the largest
 * dust island: every real island is larger than any dust island on one part, since dust is at most
 * {@link DUST_MAX_PX} px and a share of at most {@link DUST_MAX_SHARE}) and the real islands' px; or why the lattice
 * is kept. A reading that is not a real piece or a tie for the largest — no art, or one island — is not this path's.
 */
export function islandsJoin(islands: readonly number[], lattice: Pick<MeshAttachment, 'weights'>): { stray: number | undefined; real: number[]; bone: string } | { keep: string } | null {
  if (islands.length < 2) return null;
  const art = islands.reduce((a, b) => a + b, 0);
  const real = islands.filter((n, i) => i === 0 || n === islands[0] || !isDust(n, art));
  const dust = islands.filter((n, i) => !(i === 0 || n === islands[0] || !isDust(n, art)));
  if (real.length < 2) return null;
  const c = carriedBy(lattice);
  if (c.bones.length === 1 && c.blended === 0) return { stray: dust.length === 0 ? undefined : dust[0], real, bone: c.bones[0] };
  return {
    keep: `its ${real.length} real islands are carried by different bones — the lattice's ${c.vertices} vertices are bound to ${c.bones.map((b) => `"${b}"`).join(', ')}${c.blended > 0 ? `, ${c.blended} of them to more than one` : ''} — and mesh-draft joins islands by bridges only when every vertex is bound to one and the same bone, so that no island moves against another and no bridge between them stretches (issue #326)`,
  };
}

/** The dense reference's lattice cell, px: Stage C's sample stride, the least whole number keeping a part's art at or under {@link DENSE_MAX_SAMPLES} samples. */
export function denseGrid(artPx: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(artPx / DENSE_MAX_SAMPLES)));
}

/** The pixels of an image with alpha above `ART_ALPHA`. */
export function artPixels(image: Raster): number {
  let n = 0;
  for (let i = 0; i < image.width * image.height; i++) if (image.data[i * 4 + 3] > ART_ALPHA) n++;
  return n;
}

// ---------------------------------------------------------------------------
// the bend set
// ---------------------------------------------------------------------------

/** The chain links a mesh's segments name — every link of a named chain, a named link, the bone of an explicit segment that is a link — in config order. */
export function bendLinks(cfg: Pick<CharacterConfig, 'bones'>, segments: readonly Segment[]): string[] {
  const chains = new Map<string, string[]>();
  for (const b of cfg.bones) if ('chain' in b) chains.set(b.chain, b.points.map((_p, k) => `${b.chain}${k}`));
  const links = new Set([...chains.values()].flat());
  const out: string[] = [];
  const add = (n: string): void => {
    if (!out.includes(n)) out.push(n);
  };
  for (const s of segments) {
    const name = typeof s === 'string' ? s : s[0];
    if (typeof s === 'string' && chains.has(s)) for (const l of chains.get(s) as string[]) add(l);
    else if (links.has(name)) add(name);
  }
  return out;
}

/** The two animations one part's bend set is walked as. */
export function bendAnimationNames(part: string): [string, string] {
  return [`mesh-draft ${part} +${BEND_DEGREES}`, `mesh-draft ${part} -${BEND_DEGREES}`];
}

/** What every bend animation says of itself in the comparison builds' `motion.json`. */
export const BEND_NOTE = `rig-parts mesh-draft: the bend set — every chain link the part's segments name turned by the stated degrees about its joint, walked at time 0 by the gate's comparison only; never written`;

/** Each part's two bend animations: one key at time 0 on every link, `rotate` by +θ or −θ, duration 0. */
export function bendAnimations(sets: ReadonlyArray<{ part: string; links: readonly string[] }>): Record<string, { duration: number; note: string; tracks: Array<{ bone: string; property: string; keys: Array<{ t: number; v: number[] }> }> }> {
  const out: ReturnType<typeof bendAnimations> = {};
  for (const s of sets) {
    if (s.links.length === 0) continue;
    const [plus, minus] = bendAnimationNames(s.part);
    for (const [name, v] of [[plus, BEND_DEGREES], [minus, -BEND_DEGREES]] as const) {
      out[name] = { duration: 0, note: BEND_NOTE, tracks: s.links.map((bone) => ({ bone, property: 'rotate', keys: [{ t: 0, v: [v] }] })) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// the readings and the gate
// ---------------------------------------------------------------------------

/** A bend reading: the worst sample against the dense reference, rig px, and the inverted triangles summed over both poses. */
export interface BendFigure {
  worst: number;
  inverted: number;
}

export interface PartReadings {
  /** Every `check` problem laid on the part by {@link partsNamed}: empty when every bar reading it passed. Null when not read. */
  bars: string[] | null;
  /** The candidate's worst idle sample against the lattice, rig px; a string says why it was not measured. */
  idle: number | string;
  /** Null when the part's segments name no chain link (an empty bend set); a string says why it was not measured. */
  bend: { links: string[]; lattice: BendFigure; candidate: BendFigure } | string | null;
  /** Reading 5 (HQ's ruling on #295): the two meshes' triangle counts; a string says why they were not read. */
  triangles: { lattice: number; candidate: number } | string;
}

export interface GateLine {
  reading: Reading;
  pass: boolean;
  text: string;
  /**
   * How far the reading sits from its line: the value read, the line, and `percent` = 100 · (line − value) / line —
   * positive inside the line, negative past it; null when the line is 0. Null for a reading with no number (bars, an
   * empty bend set, a reading not measured).
   */
  margin: { value: number; line: number; percent: number | null } | null;
}

const fx = (v: number): string => String(pyRound(v, 3));

/** A reading's margin to its line ({@link GateLine.margin}), 6 decimals. */
export function marginTo(value: number, line: number): { value: number; line: number; percent: number | null } {
  return { value: pyRound(value, 6), line: pyRound(line, 6), percent: line === 0 ? null : pyRound((100 * (line - value)) / line, 6) };
}

/** The five readings against their lines; `pass` only when every line passes. A reading that was not measured fails: missing is not a pass. */
export function gateVerdict(r: PartReadings, moreTriangles = false): { pass: boolean; lines: GateLine[] } {
  const lines: GateLine[] = [];
  if (r.bars === null) lines.push({ reading: 'bars', pass: false, text: 'not read: the drafted rig was not checked', margin: null });
  else lines.push({ reading: 'bars', pass: r.bars.length === 0, text: r.bars.length === 0 ? 'every check bar reading the part passed' : `${r.bars.length} check problem(s) name the part: ${r.bars.join('; ')}`, margin: null });
  if (typeof r.idle === 'string') lines.push({ reading: 'idle', pass: false, text: `not measured: ${r.idle}`, margin: null });
  else lines.push({ reading: 'idle', pass: r.idle <= IDLE_BOUND_PX, text: `${fx(r.idle)} rig px from the lattice over the idle; at most ${IDLE_BOUND_PX} is required`, margin: marginTo(r.idle, IDLE_BOUND_PX) });
  if (r.bend === null) {
    const none = 'the part\'s segments name no chain link, so its bend set is empty and there is nothing to read';
    lines.push({ reading: 'bend inverted', pass: true, text: none, margin: null });
    lines.push({ reading: 'bend worst', pass: true, text: none, margin: null });
  } else if (typeof r.bend === 'string') {
    lines.push({ reading: 'bend inverted', pass: false, text: `not measured: ${r.bend}`, margin: null });
    lines.push({ reading: 'bend worst', pass: false, text: `not measured: ${r.bend}`, margin: null });
  } else {
    const { lattice: l, candidate: c } = r.bend;
    lines.push({ reading: 'bend inverted', pass: c.inverted <= l.inverted, text: `${c.inverted} inverted triangle(s) at the bend set against the lattice's ${l.inverted}; no more than the lattice's is required`, margin: marginTo(c.inverted, l.inverted) });
    const line = l.worst * (1 + BEND_WORST_SHARE);
    const share = l.worst > 0 ? ` (${c.worst >= l.worst ? '+' : ''}${fx((100 * (c.worst - l.worst)) / l.worst)} %)` : '';
    lines.push({ reading: 'bend worst', pass: c.worst <= line, text: `worst sample ${fx(c.worst)} rig px from the dense reference at the bend set against the lattice's ${fx(l.worst)}${share}; at most ${fx(line)} (the lattice's + ${BEND_WORST_SHARE * 100} %) is required`, margin: marginTo(c.worst, line) });
  }
  if (typeof r.triangles === 'string') lines.push({ reading: 'triangles', pass: false, text: `not read: ${r.triangles}`, margin: null });
  else if (moreTriangles) {
    const d = r.triangles.candidate - r.triangles.lattice;
    lines.push({ reading: 'triangles', pass: true, text: `${r.triangles.candidate} triangle(s) against the lattice's ${r.triangles.lattice} (${d >= 0 ? '+' : ''}${d}); not a line under ${MORE_TRIANGLES_FLAG}, which accepts a candidate holding the four motion readings whatever its triangles`, margin: marginTo(r.triangles.candidate, r.triangles.lattice) });
  } else lines.push({ reading: 'triangles', pass: r.triangles.candidate <= r.triangles.lattice, text: `${r.triangles.candidate} triangle(s) against the lattice's ${r.triangles.lattice}; no more than the lattice's is required (${MORE_TRIANGLES_FLAG} lifts this line)`, margin: marginTo(r.triangles.candidate, r.triangles.lattice) });
  return { pass: lines.every((x) => x.pass), lines };
}

/** The attachment-level row of `code` for one attachment in a compare report's candidate (by index), or null. */
function rowOf(report: MeshQualityReport, candidate: number, part: string, code: string): MeasureRow | null {
  return report.candidates[candidate]?.motion?.rows.find((r) => r.code === code && r.object.region === null && r.object.attachment.slot === part) ?? null;
}

/** Reading 2 off the idle comparison (the lattice the reference, the candidate its one candidate): the value, or why there is none. */
export function idleReading(report: MeshQualityReport, part: string): number | string {
  const row = rowOf(report, 0, part, 'MQ_LOCAL_DEFORMATION');
  if (row === null) return `rig-c's comparison holds no MQ_LOCAL_DEFORMATION row for "${part}"`;
  if (row.value === null) return `rig-c's MQ_LOCAL_DEFORMATION for "${part}" is ${row.state}: ${row.reason ?? 'no reason given'}`;
  return row.value;
}

/** The per-frame label rig-c gives an attachment-level row when a call compares several attachments (`perFrame`). */
export function perFrameLabel(code: string, part: string, attachments: number): string {
  return attachments > 1 ? `${code}[(no skin)/${part}/${part}]` : code;
}

/**
 * Readings 3 and 4 off the bend comparison (the dense reference, candidates [lattice, candidate], `perFrame`): over
 * the part's own two frames, the largest `MQ_LOCAL_DEFORMATION` and the sum of `MQ_INVERSION`, per build.
 */
export function bendReading(report: MeshQualityReport, part: string, attachments: number): { lattice: BendFigure; candidate: BendFigure } | string {
  const frames = bendAnimationNames(part).map(explicitFrameId);
  const figure = (k: number): BendFigure | string => {
    const pf = report.candidates[k]?.perFrame;
    if (pf === undefined) return `rig-c's comparison returned no per-frame table for candidate ${k}`;
    const at = (code: string): Array<number | null> => frames.map((f) => pf.find((e) => e.code === perFrameLabel(code, part, attachments) && e.frame === f)?.value ?? null);
    const local = at('MQ_LOCAL_DEFORMATION');
    const inv = at('MQ_INVERSION');
    if (local.some((v) => v === null) || inv.some((v) => v === null)) return `rig-c's per-frame table has no reading of "${part}" at ${frames.join(' or ')}`;
    return { worst: Math.max(...(local as number[])), inverted: (inv as number[]).reduce((a, b) => a + b, 0) };
  };
  const l = figure(0);
  const c = figure(1);
  if (typeof l === 'string') return l;
  if (typeof c === 'string') return c;
  return { lattice: l, candidate: c };
}

// ---------------------------------------------------------------------------
// laying a check problem on the parts it names
// ---------------------------------------------------------------------------

/** One seam pair's count, as check.json's seam_pairs holds it. */
export interface SeamCount {
  parts: [string, string];
  px_over_40: number;
}

/**
 * The parts among `among` a failing problem names, by the bar's own words: a `STILL_REGIONS_DARK` problem the slot it
 * opens with; a seam problem every part of a pair whose count on the drafted rig is above the lattice's (`seams`);
 * any other the parts quoted in its object (`"name"`, or `config.meshes.<name>`), else in its detail. Empty when it
 * names none of them.
 */
export function partsNamed(p: Problem, among: readonly string[], seams: { draft: readonly SeamCount[]; lattice: readonly SeamCount[] } | null): string[] {
  if (p.code === 'CHECK_STILL_REGIONS_DARK') {
    const slot = /^slot "([^"]+)"/.exec(p.object)?.[1];
    return slot !== undefined && among.includes(slot) ? [slot] : [];
  }
  if (p.code === 'CHECK_SEAM_WITHIN_BAR') {
    if (seams === null) return [];
    const key = (s: SeamCount): string => [...s.parts].sort().join('\u0000');
    const before = new Map(seams.lattice.map((s) => [key(s), s.px_over_40]));
    const grew = seams.draft.filter((s) => s.px_over_40 > (before.get(key(s)) ?? 0));
    return among.filter((n) => grew.some((s) => s.parts.includes(n)));
  }
  const quoted = (text: string): string[] => among.filter((n) => text.includes(`"${n}"`) || text.includes(`config.meshes.${n}.`) || text.endsWith(`config.meshes.${n}`) || text.includes(`config.meshes.${n} `));
  const inObject = quoted(p.object);
  return inObject.length > 0 ? inObject : quoted(p.detail);
}

// ---------------------------------------------------------------------------
// the config written: the input's own text, with the drafted entries spliced in
// ---------------------------------------------------------------------------

/**
 * Where a JSON value starts and ends in a text, by a path of object keys and array indices (a number steps to that
 * element of an array, issue #552), and (for a non-empty path) where the last step starts (`key`: a member's opening
 * quote, or the element itself). Throws when the path does not resolve.
 */
export function jsonValueSpan(text: string, path: readonly (string | number)[]): { start: number; end: number; key?: number } {
  let i = 0;
  const ws = (): void => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const str = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const skip = (): void => {
    ws();
    const ch = text[i];
    if (ch === '"') {
      str();
      return;
    }
    if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      i++;
      ws();
      if (text[i] === close) {
        i++;
        return;
      }
      for (;;) {
        if (ch === '{') {
          ws();
          str();
          ws();
          i++; // ':'
        }
        skip();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        i++; // the close
        return;
      }
    }
    while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
  };
  let keyAt: number | undefined;
  const find = (depth: number): { start: number; end: number; key?: number } => {
    ws();
    if (depth === path.length) {
      const start = i;
      skip();
      return keyAt === undefined ? { start, end: i } : { start, end: i, key: keyAt };
    }
    const step = path[depth];
    if (typeof step === 'number') {
      if (text[i] !== '[') throw new Error(`jsonValueSpan: ${path.slice(0, depth).join('.') || 'the document'} is not an array`);
      i++;
      for (let n = 0; ; n++) {
        ws();
        if (text[i] === ']') throw new Error(`jsonValueSpan: no element ${step} at ${path.slice(0, depth).join('.') || 'the top'}`);
        if (n === step) {
          keyAt = i;
          return find(depth + 1);
        }
        skip();
        ws();
        if (text[i] === ',') i++;
      }
    }
    if (text[i] !== '{') throw new Error(`jsonValueSpan: ${path.slice(0, depth).join('.') || 'the document'} is not an object`);
    i++;
    for (;;) {
      ws();
      if (text[i] === '}') throw new Error(`jsonValueSpan: no key "${path[depth]}" at ${path.slice(0, depth).join('.') || 'the top'}`);
      const at = i;
      const key = str();
      ws();
      i++; // ':'
      if (key === path[depth]) {
        keyAt = at;
        return find(depth + 1);
      }
      skip();
      ws();
      if (text[i] === ',') i++;
    }
  };
  return find(0);
}

/**
 * One edit {@link splicedEdits} makes: the value at `path` set (replaced, or inserted when absent), or, `undefined`,
 * removed. A path whose last step is an index (issue #552) addresses an array element: set replaces it, `undefined`
 * removes it, and `insert` puts `value` before it (at the array's length: after its last element), every later
 * element moving up one.
 */
export interface ConfigEdit {
  path: readonly (string | number)[];
  value: unknown;
  insert?: boolean;
  /**
   * With `insert` (issue #671): in an array written on one line, the element goes in as `JSON.stringify(value)`
   * beside its neighbours on that line, so a one-line plan stays one line; elsewhere it changes nothing.
   */
  inline?: boolean;
}

/** The span at `path`, or null where the path does not resolve (a key absent, or a step that is not an object). */
function spanOrNull(text: string, path: readonly (string | number)[]): { start: number; end: number; key?: number } | null {
  try {
    return jsonValueSpan(text, path);
  } catch {
    return null;
  }
}

/** The white space a line starts with, for the line `at` lies on. */
function indentAt(text: string, at: number): string {
  const lineStart = text.lastIndexOf('\n', at) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? '';
}

/** An element inserted into the array at `arrayPath` before its element `index` (at its length: after the last). */
function insertElement(text: string, arrayPath: readonly (string | number)[], index: number, value: unknown, inline = false): string {
  const arr = spanOrNull(text, arrayPath);
  if (arr === null || text[arr.start] !== '[') throw new Error(`splicedEdits: ${arrayPath.join('.') || 'the document'} is not an array`);
  const next = spanOrNull(text, [...arrayPath, index]);
  if (inline && !text.slice(arr.start, arr.end).includes('\n')) {
    const body = JSON.stringify(value);
    if (next !== null) return `${text.slice(0, next.start)}${body},${text.slice(next.start)}`;
    const last = index > 0 ? spanOrNull(text, [...arrayPath, index - 1]) : null;
    if (index > 0 && last === null) throw new Error(`splicedEdits: ${arrayPath.join('.')} has no element ${index - 1}`);
    if (last === null) return `${text.slice(0, arr.start + 1)}${body}${text.slice(arr.end - 1)}`;
    return `${text.slice(0, last.end)},${body}${text.slice(last.end)}`;
  }
  if (next !== null) {
    // Before the element: the new one takes its line, and the old one follows on a line of its own at the same indent.
    const indent = indentAt(text, next.start);
    const body = JSON.stringify(value, null, 2).split('\n').join(`\n${indent}`);
    return `${text.slice(0, next.start)}${body},\n${indent}${text.slice(next.start)}`;
  }
  const prev = index > 0 ? spanOrNull(text, [...arrayPath, index - 1]) : null;
  if (index > 0 && prev === null) throw new Error(`splicedEdits: ${arrayPath.join('.')} has no element ${index - 1}`);
  const indent = prev !== null ? indentAt(text, prev.start) : `${indentAt(text, arr.start)}  `;
  const body = JSON.stringify(value, null, 2).split('\n').join(`\n${indent}`);
  if (prev === null) return `${text.slice(0, arr.start + 1)}\n${indent}${body}\n${indentAt(text, arr.start)}${text.slice(arr.end - 1)}`;
  return `${text.slice(0, prev.end)},\n${indent}${body}${text.slice(prev.end)}`;
}

/** One edit on `text`; every byte it does not name is the input's. */
function spliceOne(text: string, path: readonly (string | number)[], value: unknown, insert = false, inline = false): string {
  const step = path[path.length - 1];
  if (insert) {
    if (typeof step !== 'number') throw new Error(`splicedEdits: an insert names an array index; ${path.join('.')} does not`);
    return insertElement(text, path.slice(0, -1), step, value, inline);
  }
  const at = spanOrNull(text, path);
  if (value === undefined) {
    if (at === null || at.key === undefined) return text;
    // The member and one comma beside it: the one before it, or (the first member) the one after it.
    let before = at.key - 1;
    while (before >= 0 && /\s/.test(text[before])) before--;
    if (text[before] === ',') return `${text.slice(0, before)}${text.slice(at.end)}`;
    let after = at.end;
    while (after < text.length && /\s/.test(text[after])) after++;
    // An array's only element: the brackets close on each other.
    if (typeof step === 'number' && text[before] === '[' && text[after] === ']') return `${text.slice(0, before + 1)}${text.slice(after)}`;
    if (text[after] === ',') {
      after++;
      while (after < text.length && /\s/.test(text[after])) after++;
      return `${text.slice(0, at.key)}${text.slice(after)}`;
    }
    return `${text.slice(0, at.key)}${text.slice(at.end)}`;
  }
  if (at !== null) {
    const body = JSON.stringify(value, null, 2).split('\n').join(`\n${indentAt(text, at.start)}`);
    return `${text.slice(0, at.start)}${body}${text.slice(at.end)}`;
  }
  if (typeof step === 'number') throw new Error(`splicedEdits: ${path.join('.')} names no element; an element is added by an insert`);
  const parentPath = path.slice(0, -1);
  const parent = spanOrNull(text, parentPath);
  // A parent the text lacks is inserted whole, holding this one member.
  if (parent === null) return spliceOne(text, parentPath, { [step]: value });
  if (text[parent.start] !== '{') throw new Error(`splicedEdits: ${parentPath.join('.') || 'the document'} is not an object`);
  const indent = `${indentAt(text, parent.start)}  `;
  const member = `"${step}": ${JSON.stringify(value, null, 2).split('\n').join(`\n${indent}`)}`;
  let last = parent.end - 2;
  while (last > parent.start && /\s/.test(text[last])) last--;
  if (last === parent.start) return `${text.slice(0, parent.start + 1)}\n${indent}${member}\n${indentAt(text, parent.start)}${text.slice(parent.end - 1)}`;
  return `${text.slice(0, last + 1)},\n${indent}${member}${text.slice(last + 1)}`;
}

/** The first path, depth first in the intended document's key order, where `got` and `want` differ. */
function firstMoved(got: unknown, want: unknown, path: readonly string[]): string | null {
  const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (plain(got) && plain(want)) {
    for (const k of [...Object.keys(want), ...Object.keys(got).filter((k) => !(k in want))]) {
      const m = firstMoved(got[k], want[k], [...path, k]);
      if (m !== null) return m;
    }
    return null;
  }
  return JSON.stringify(got) === JSON.stringify(want) ? null : path.join('.') || 'the document';
}

/**
 * The input's own text with each edit made in order: a value present is replaced, as `JSON.stringify(value, null, 2)`
 * indented to the line it starts on; one absent is inserted as the last member of its object (an absent parent
 * inserted with it); `undefined` removes the member. An index step addresses an array element (issue #552): replaced
 * or removed in place, or, `insert`, put before that element on a line of its own at the neighbours' indent (after
 * the last element at the array's length), and a removed element takes one comma beside it. Every other byte is the
 * input's. The result is parsed and held
 * to the intended document — the input parsed with the same edits made on it — and `moved` names the first path
 * where it is not (a key the text states twice is the way it is not: the edit lands on the first, the parse keeps the
 * last); null when it is.
 */
export function splicedEdits(text: string, edits: readonly ConfigEdit[]): { text: string; moved: string | null } {
  let out = text;
  for (const e of edits) out = spliceOne(out, e.path, e.value, e.insert === true, e.inline === true);
  const want = JSON.parse(text) as Record<string, unknown>;
  for (const e of edits) {
    let o: Record<string | number, unknown> | unknown[] = want;
    for (const k of e.path.slice(0, -1)) {
      const rec = o as Record<string | number, unknown>;
      if (typeof rec[k] !== 'object' || rec[k] === null) rec[k] = {};
      o = rec[k] as Record<string | number, unknown> | unknown[];
    }
    const last = e.path[e.path.length - 1];
    if (Array.isArray(o) && typeof last === 'number') {
      if (e.insert === true) o.splice(last, 0, e.value);
      else if (e.value === undefined) o.splice(last, 1);
      else o[last] = e.value;
    } else {
      const rec = o as Record<string | number, unknown>;
      if (e.value === undefined) delete rec[last];
      else rec[last] = e.value;
    }
  }
  return { text: out, moved: firstMoved(JSON.parse(out), want, []) };
}

/**
 * The config written: `text` with `meshes.<part>` replaced for every part in `drafted`, each entry as
 * `JSON.stringify(entry, null, 2)` indented to the line its key starts on ({@link splicedEdits}). Every other byte is
 * the input's, so a config with nothing drafted is written byte for byte as read, and a part that keeps its lattice
 * keeps its text. The result is parsed and held to the intended document before it is returned.
 */
export function splicedConfig(text: string, drafted: ReadonlyMap<string, unknown>): string {
  for (const part of drafted.keys()) jsonValueSpan(text, ['meshes', part]);
  const r = splicedEdits(text, [...drafted].map(([part, entry]) => ({ path: ['meshes', part], value: entry })));
  if (r.moved !== null) throw new Error('splicedConfig: the spliced text does not parse to the intended config');
  return r.text;
}

/** A path in a config the loader resolves against the config's directory, and how to set it. */
export interface RelativeConfigPath {
  at: string;
  value: string;
  set: (v: string) => void;
}

/**
 * Each path in `o` (a parsed config) the loader resolves against the config's directory — `motion.animations_from`,
 * `generation.control.skeleton` — where it is relative and names a file there.
 */
export function relativeConfigPaths(configDir: string, o: Json): RelativeConfigPath[] {
  const out: RelativeConfigPath[] = [];
  const motion = o.motion as Json | undefined;
  if (motion !== undefined && typeof motion.animations_from === 'string' && !isAbsolute(motion.animations_from) && existsSync(resolve(configDir, motion.animations_from))) {
    out.push({ at: 'motion.animations_from', value: motion.animations_from, set: (v) => (motion.animations_from = v) });
  }
  const control = (o.generation as Json | undefined)?.control as Json | undefined;
  if (control !== undefined && typeof control.skeleton === 'string' && !isAbsolute(control.skeleton) && existsSync(resolve(configDir, control.skeleton))) {
    out.push({ at: 'generation.control.skeleton', value: control.skeleton, set: (v) => (control.skeleton = v) });
  }
  return out;
}

/**
 * A config the stage builds, written as `<dir>/config.json`: `text` (the author's config at `configPath`) with
 * `meshes.<part>` replaced for every part in `meshes`, and each of its {@link relativeConfigPaths} made absolute, so
 * it resolves to the file the author's config names. `remesh` (issue #495) builds through the same door.
 */
export function scratchConfig(configPath: string, text: string, dir: string, meshes: ReadonlyMap<string, unknown>): string {
  const configDir = dirname(resolve(configPath));
  const o = JSON.parse(text) as Json;
  for (const r of relativeConfigPaths(configDir, o)) r.set(resolve(configDir, r.value));
  o.meshes = { ...(o.meshes as Json), ...Object.fromEntries(meshes) };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(o, null, 2)}\n`);
  return join(dir, 'config.json');
}

// ---------------------------------------------------------------------------
// the stage
// ---------------------------------------------------------------------------

export interface MeshDraftInput {
  config: string;
  /** The directory holding parts.json and parts/<name>.png. */
  parts: string;
  out: string;
  requirements?: string;
  idleKeys?: IdleKeys;
  pageEdges?: PageEdges;
  packShape?: PackShape;
  /** `--more-triangles` ({@link MORE_TRIANGLES_FLAG}): reading 5 is reported, not a line. Absent or false: it is a line. */
  moreTriangles?: boolean;
}

/** A part's figures: triangles, and the mesh's area over the art's (overdraw). */
export interface MeshFigure {
  triangles: number;
  overdraw: number;
}

/** A bridged candidate's bridges (issue #326), off the rig stage's mesh report: the silhouettes, each join, and their area over the part's art. */
export interface BridgeFigure {
  /** The grown silhouettes, numbered by art px: each one's islands' art px. */
  units: number[][];
  joins: Array<{ span: [number, number]; area_px2: number }>;
  /** Σ of the joins' area, px². */
  area_px2: number;
  /** That area over the part's art px: the share of the candidate's overdraw the bridges draw (4 decimals). */
  overdraw: number;
  /**
   * Only when one was left out (HQ's ruling on #326): each faint island — every pixel's alpha under `FAINT_ALPHA`
   * (`src/contour.ts`) — with its art px, its brightest pixel's alpha and its box in part-image px. Not meshed, so not
   * drawn.
   */
  faint?: Array<{ art_px: number; max_alpha: number; box: [number, number, number, number] }>;
}

export interface PartRow {
  part: string;
  /** What the written config holds for the part. */
  mode: 'contour' | 'grid';
  lattice: MeshFigure & { grid: number; art_px: number };
  /** Null when no candidate was drafted for it (a real piece, or the stage refused it before any reading). */
  candidate: (MeshFigure & { mesh: ContourMeshSpec; bridges?: BridgeFigure }) | null;
  readings: PartReadings | null;
  gate: GateLine[];
  note: string;
}

export interface MeshDraftResult {
  rules: FigureRules;
  rows: PartRow[];
  /** The entries not drafted because they are not lattices (issue #307), in config order. */
  notCompared: NotCompared[];
  written: string[];
}

/** A bridged part's {@link BridgeFigure} off `<rigDir>/mesh_report.json`, or null when the report holds none for it. */
export function bridgesOf(rigDir: string, part: string, art: number): BridgeFigure | null {
  const path = join(rigDir, 'mesh_report.json');
  if (!existsSync(path)) return null;
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<{ part: string; contour?: { bridges?: ContourBridges } }>;
  const b = rows.find((r) => r.part === part)?.contour?.bridges;
  if (b === undefined) return null;
  const area = b.joins.reduce((t, j) => t + j.area, 0);
  return {
    units: b.units,
    joins: b.joins.map((j) => ({ span: j.span, area_px2: j.area })),
    area_px2: area,
    overdraw: art === 0 ? 0 : pyRound(area / art, 4),
    ...(b.faint === undefined ? {} : { faint: b.faint.map((f) => ({ art_px: f.art, max_alpha: f.maxAlpha, box: f.box })) }),
  };
}

/** The mesh's area over the art's: the triangles' area in image px over the image's art px. */
export function overdrawOf(att: MeshAttachment, art: number): number {
  let twice = 0;
  for (let t = 0; t < att.triangles.length; t += 3) {
    const [a, b, c] = [att.triangles[t], att.triangles[t + 1], att.triangles[t + 2]];
    const [ax, ay, bx, by, cx, cy] = [att.uvs[a * 2] * att.width, att.uvs[a * 2 + 1] * att.height, att.uvs[b * 2] * att.width, att.uvs[b * 2 + 1] * att.height, att.uvs[c * 2] * att.width, att.uvs[c * 2 + 1] * att.height];
    twice += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  }
  return art === 0 ? 0 : pyRound(twice / 2 / art, 4);
}

type Json = Record<string, unknown>;

/** A part's mesh attachment in a rig spec. */
function attachmentOf(rig: RigSpec, part: string): MeshAttachment {
  return (rig.skins.default[part] as Record<string, MeshAttachment>)[part];
}

/**
 * The stage: lattice baseline, candidates, readings, gate, written config (module header). Throws a PartsError for
 * an input it refuses — a config or parts it cannot read, a figure the spacing rule gives no spacing for, a lattice
 * baseline whose `check` is not PASS, a comparison build rigc refuses or a comparison rig-c refuses — and writes
 * nothing then. Otherwise writes `<out>/config.json` and `<out>/mesh_draft.json` once the drafted config's check is
 * PASS, and returns the rows.
 */
export function meshDraftStage(input: MeshDraftInput, rigc: RigcRunner, checkBin: string, scratch: string, log: Log): MeshDraftResult {
  const text = readFileSync(input.config, 'utf8');
  const { config: cfg, animations } = loadConfigAndAnimations(input.config);
  const raw = JSON.parse(text) as Json;
  const parts = readParts(join(input.parts, 'parts.json'));
  const rules = figureRules(parts);
  if ('code' in rules) throw new PartsError([rules]);
  const images = new Map<string, Raster>();
  for (const p of parts.parts) {
    const png = join(input.parts, 'parts', `${p.name}.png`);
    if (existsSync(png)) images.set(p.name, readPng(png));
  }
  log(`rig-parts mesh-draft: ${cfg.key}, figure ${rules.height} px (rows ${rules.top}..${rules.bottom}): tolerance and margin T = max(1, round(${rules.height} / ${TOLERANCE_FIGURE_DIVISOR})) = ${rules.tolerance}, spacing and longest outline edge S = round(${rules.height} / ${FIGURE_GRID_DIVISOR}) = ${rules.spacing}`);

  const configWith = (name: string, meshes: ReadonlyMap<string, unknown>): string => scratchConfig(input.config, text, join(scratch, name), meshes);
  function stage(name: string, meshes: ReadonlyMap<string, unknown>, check: false): { rigDir: string } | { refused: Problem[] };
  function stage(name: string, meshes: ReadonlyMap<string, unknown>, check: true): { rigDir: string; report: CheckReport } | { refused: Problem[] };
  function stage(name: string, meshes: ReadonlyMap<string, unknown>, check: boolean): { rigDir: string; report?: CheckReport } | { refused: Problem[] } {
    const rigDir = join(scratch, name, 'rig');
    const at = configWith(name, meshes);
    try {
      rigStage({ config: at, parts: input.parts, out: rigDir, ...(input.idleKeys === undefined ? {} : { idleKeys: input.idleKeys }), ...(input.pageEdges === undefined ? {} : { pageEdges: input.pageEdges }), ...(input.packShape === undefined ? {} : { packShape: input.packShape }) }, rigc, join(scratch, name, 'gate'), (l) => log(`[${name}:rig] ${l}`));
      if (!check) return { rigDir };
      const report = checkStage({ rig: rigDir, parts: input.parts, out: join(scratch, name, 'check'), seamPairs: true, ...(input.requirements === undefined ? {} : { requirements: input.requirements }), ...(input.pageEdges === undefined ? {} : { pageEdges: input.pageEdges }), ...(input.packShape === undefined ? {} : { packShape: input.packShape }) }, rigc, checkBin, (l) => log(`[${name}:check] ${l}`));
      return { rigDir, report };
    } catch (err) {
      if (!(err instanceof PartsError)) throw err;
      return { refused: [...err.problems] };
    }
  }

  // 1. The lattice baseline: the config as given. A gate held against a red baseline is no gate, so it must be PASS.
  const base = stage('lattice', new Map(), true);
  if ('refused' in base || !base.report.figures.PASS) {
    const why = 'refused' in base ? base.refused : base.report.problems;
    throw new PartsError(why.map((p) => ({ code: 'MESH_DRAFT_LATTICE_GREEN', object: `${input.config} as written (every lattice part on its lattice)`, detail: `${problemLine(p)}; the gate holds each candidate to the lattice it would replace, so the config as written must build and check PASS first` })));
  }
  const latticeRig = JSON.parse(readFileSync(join(base.rigDir, 'rig.json'), 'utf8')) as RigSpec;

  // 2. Candidates for every lattice entry; a real piece keeps the lattice.
  const rows = new Map<string, PartRow>();
  const candidates = new Map<string, ContourMeshSpec>();
  const joined = new Map<string, { stray: number | undefined; real: number[]; bone: string }>();
  for (const [part, spec] of Object.entries(cfg.meshes)) {
    if (!('grid' in spec)) continue;
    const img = images.get(part);
    const att = attachmentOf(latticeRig, part);
    const art = img === undefined ? 0 : artPixels(img);
    const row: PartRow = { part, mode: 'grid', lattice: { grid: spec.grid, art_px: art, triangles: att.triangles.length / 3, overdraw: overdrawOf(att, art) }, candidate: null, readings: null, gate: [], note: '' };
    rows.set(part, row);
    if (img === undefined) {
      row.note = 'keeps its lattice: parts/ holds no image for it';
      continue;
    }
    const dust = dustOf(img);
    if ('keep' in dust) {
      // Issue #326: islands carried by one bone are drafted per island and joined by bridges.
      const join = islandsJoin(dust.islands, att);
      if (join === null || 'keep' in join) {
        row.note = `keeps its lattice: ${dust.keep}${join === null ? '' : `; ${join.keep}`}`;
        continue;
      }
      joined.set(part, join);
      candidates.set(part, candidateMesh(spec, rules, join.stray, true));
      continue;
    }
    candidates.set(part, candidateMesh(spec, rules, dust.stray));
  }
  const dustText = (part: string): string => {
    const j = joined.get(part);
    if (j !== undefined) {
      const img = images.get(part) as Raster;
      const dust = (dustOf(img) as { islands: number[] }).islands.slice(j.real.length);
      return `${dust.length === 0 ? 'no dust' : `stray ${j.stray as number} leaves out ${dust.length} dust island(s) of ${dust.join(', ')} px`}; ${bridgeText(row(part))}`;
    }
    const img = images.get(part);
    const d = img === undefined ? null : dustOf(img);
    return d === null || 'keep' in d || d.dust.length === 0 ? 'no dust' : `stray ${d.stray as number} leaves out ${d.dust.length} dust island(s) of ${d.dust.join(', ')} px`;
  };
  const row = (part: string): PartRow => rows.get(part) as PartRow;
  const faintText = (faint: NonNullable<BridgeFigure['faint']>): string =>
    `LEFT OUT as faint, every pixel under alpha ${FAINT_ALPHA}: ${faint.map((f) => `${f.art_px} px (brightest alpha ${f.max_alpha}, at part-image px ${f.box[0]},${f.box[1]} ${f.box[2]}x${f.box[3]})`).join('; ')} — not meshed, so not drawn; if those pixels matter to you, keep the lattice for this part`;
  const bridgeText = (r: PartRow): string => {
    const j = joined.get(r.part) as { real: number[]; bone: string };
    const b = r.candidate?.bridges;
    const joins =
      b === undefined
        ? 'its bridges were not read'
        : b.joins.length === 0
          ? 'no bridge'
          : `${b.joins.length} bridge(s) of ${b.joins.map((x) => `${x.span[0]} and ${x.span[1]} px`).join('; ')} span, ${b.area_px2} px² over no art (overdraw ${b.overdraw} of the candidate's ${r.candidate?.overdraw}; overdraw is reported, never a reason to leave art out)`;
    const faint = b?.faint ?? [];
    const visible = j.real.length - faint.length;
    return `its ${j.real.length} real islands (${j.real.join(', ')} px)${faint.length === 0 ? '' : `: ${faintText(faint)}; the ${visible} visible`} traced as ${b === undefined ? 'its' : b.units.length} grown silhouette(s) and joined into one outline by ${joins}, every vertex bound to the one bone "${j.bone}" (issue #326)`;
  };

  // 3. The drafted rig must build: a refusal laid on a part keeps that part's lattice.
  const keep = (part: string, reading: Reading, text: string): void => {
    const row = rows.get(part) as PartRow;
    row.gate.push({ reading, pass: false, text, margin: null });
    candidates.delete(part);
  };
  let draftedRig: { rigDir: string } | null = null;
  for (let round = 0; candidates.size > 0; round++) {
    const r = stage(`draft-${round}`, candidates, false);
    if (!('refused' in r)) {
      draftedRig = r;
      break;
    }
    const among = [...candidates.keys()];
    const laid = new Set<string>();
    for (const p of r.refused) for (const n of partsNamed(p, among, null)) {
      laid.add(n);
      keep(n, 'bars', `the drafted rig is refused at the rig stage: ${problemLine(p)}`);
    }
    if (laid.size === 0) for (const n of among) keep(n, 'bars', `the drafted rig is refused at the rig stage, naming no part: ${r.refused.map(problemLine).join('; ')}`);
  }

  // 4. Readings 2-4, through rig-c's comparison of three unpacked gate builds that differ in the candidates' attachments only.
  if (draftedRig !== null && candidates.size > 0) {
    const draftRig = JSON.parse(readFileSync(join(draftedRig.rigDir, 'rig.json'), 'utf8')) as RigSpec;
    const motion = JSON.parse(readFileSync(join(draftedRig.rigDir, 'motion.json'), 'utf8')) as Json;
    const names = [...candidates.keys()];
    const sets = names.map((part) => ({ part, links: bendLinks(cfg, cfg.meshes[part].segments) }));
    const bends = bendAnimations(sets);
    const taken = Object.keys(bends).filter((n) => n in ((motion.animations ?? {}) as Json));
    if (taken.length > 0) {
      throw new PartsError([{ code: 'MESH_DRAFT_BEND_NAMES', object: `motion.json${animations === null ? '' : ` (with ${animations.file})`}`, detail: `already holds the animation(s) ${taken.map((n) => `"${n}"`).join(', ')}, which the gate's bend set is walked as; rename them — a bend is added beside the motion's animations and never replaces one` }]);
    }
    const bentMotion = rigJsonText({ ...motion, animations: { ...(motion.animations as Json), ...bends } });
    // The dense reference: the same parts as lattices at the reference's spacing, built in-process; only their attachments are read.
    const denseMeshes = new Map<string, LatticeMeshSpec>();
    for (const part of names) {
      const l = cfg.meshes[part] as LatticeMeshSpec;
      denseMeshes.set(part, { grid: denseGrid(artPixels(images.get(part) as Raster)), r: l.r, segments: l.segments, ...(l.exponent === undefined ? {} : { exponent: l.exponent }), ...(l.rule === undefined ? {} : { rule: l.rule }), ...(l.influences === undefined ? {} : { influences: l.influences }) });
    }
    const denseRig = buildRig({ ...cfg, meshes: { ...cfg.meshes, ...Object.fromEntries(denseMeshes) } }, parts, images, undefined, input.idleKeys).rig;
    const pngs: Array<[string, Uint8Array]> = readdirSync(join(draftedRig.rigDir, 'images')).sort().map((f) => [f, new Uint8Array(readFileSync(join(draftedRig.rigDir, 'images', f)))]);
    const model = (label: string, from: RigSpec | null): string => {
      const rig = JSON.parse(rigJsonText(draftRig)) as RigSpec;
      if (from !== null) for (const part of names) rig.skins.default[part] = { [part]: attachmentOf(from, part) };
      let doc: string | null = null;
      const [g] = gateThroughRigc(pngs, [['rig.json', rigJsonText(rig)], ['motion.json', bentMotion]], rigc, join(scratch, `compare-${label}`), null, (dir) => {
        const p = join(dir, RIGC_MODEL_DOCUMENT);
        doc = existsSync(p) ? readFileSync(p, 'utf8') : null;
      });
      log(`[compare] rigc ${g.label}, the drafted rig with every candidate part as its ${label}: exit ${g.status}`);
      for (const l of g.lines) log(`[compare]   ${l.trim()}`);
      if (g.status !== 0 || doc === null) {
        throw new PartsError([{ code: 'MESH_DRAFT_COMPARE_BUILD', object: `the comparison build with every candidate part as its ${label}`, detail: `rigc's gate ${g.status !== 0 ? `exited ${g.status}: ${g.lines.map((l) => l.trim()).join(' | ')}` : `wrote no ${RIGC_MODEL_DOCUMENT}`}; a build that is not gated is not evidence, and nothing is written` }]);
      }
      return doc;
    };
    const latticeDoc = model('lattice', latticeRig);
    const candidateDoc = model('candidate', null);
    const denseDoc = model('dense reference', denseRig);
    const masks = new Map<string, AlphaMask>();
    for (const part of names) {
      const att = attachmentOf(draftRig, part);
      const img = readPng(join(draftedRig.rigDir, 'images', att.image));
      const alpha = new Uint8Array(img.width * img.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
      masks.set(part, { width: img.width, height: img.height, alpha });
    }
    const compare = (what: string, reference: string, cands: string[], schedule: MotionSchedule, perFrame: boolean): MeshQualityReport => {
      const inputC: MotionComparisonInput = {
        reference: { id: 'reference', model: reference },
        candidates: cands.map((m, i) => ({ id: `candidate ${i}`, model: m })),
        attachments: names.map((part) => {
          const mask = masks.get(part) as AlphaMask;
          return { attachment: { skin: null, slot: part, attachment: part }, art: { mask, threshold: 1, frame: { space: 'part-local-drawing-px-y-down', width: mask.width, height: mask.height, pageScale: 1, conversion: 'texels = px * pageScale' } }, finalThreshold: 1, minArtSamples: 1, regions: [] };
        }),
        // The gate reads motion only: the art fit is the contour mode's and check's, so no fit bound is declared here.
        referenceArtFit: NO_ART_FIT,
        candidateArtFit: NO_ART_FIT,
        schedule,
        bounds: { maxLocalDeformation: IDLE_BOUND_PX },
        motionRequired: false,
        perFrame,
      };
      try {
        return compareMeshesInMotion(inputC);
      } catch (err) {
        if (!(err instanceof MeshReductionError)) throw err;
        throw new PartsError([{ code: 'MESH_DRAFT_COMPARE', object: `the ${what} comparison`, detail: `rig-c's compareMeshesInMotion refused it (${err.code}): ${err.message}; nothing is written` }]);
      }
    };
    const idle = compare('idle', latticeDoc, [candidateDoc], idleSchedule(), false);
    const bendFrames = Object.keys(bends).map((animation) => ({ animation, times: [0] }));
    const bend = bendFrames.length === 0 ? null : compare('bend set', denseDoc, [latticeDoc, candidateDoc], { frames: bendFrames, phases: ['grid'], physics: { mode: 'step', dt: 1 / IDLE_FPS, warmupSteps: 0 }, selection: [] }, true);
    for (const { part, links } of sets) {
      const row = rows.get(part) as PartRow;
      const read = links.length === 0 ? null : bend === null ? 'no bend comparison ran' : bendReading(bend, part, names.length);
      const att = attachmentOf(draftRig, part);
      const img = images.get(part) as Raster;
      row.candidate = { triangles: att.triangles.length / 3, overdraw: overdrawOf(att, artPixels(img)), mesh: candidates.get(part) as ContourMeshSpec };
      if (joined.has(part)) {
        const b = bridgesOf(draftedRig.rigDir, part, artPixels(img));
        if (b !== null) row.candidate.bridges = b;
      }
      const readings: PartReadings = { bars: null, idle: idleReading(idle, part), bend: read === null || typeof read === 'string' ? read : { links, ...read }, triangles: { lattice: row.lattice.triangles, candidate: row.candidate.triangles } };
      row.readings = readings;
      const v = gateVerdict({ ...readings, bars: [] }, input.moreTriangles === true);
      const failed = v.lines.filter((x) => !x.pass && x.reading !== 'bars');
      if (failed.length > 0) {
        row.gate = v.lines.filter((x) => x.reading !== 'bars');
        candidates.delete(part);
      }
    }
  }

  // 5. Reading 1 on the config as it will be written: check it, lay each failing bar on the parts it names, repeat.
  let final: { rigDir: string; report: CheckReport } = base;
  const latticeSeams = (base.report.figures.seam_pairs ?? []).map((s) => ({ parts: s.parts, px_over_40: s.px_over_40 }));
  for (let round = 0; candidates.size > 0; round++) {
    const r = stage(`final-${round}`, candidates, true);
    const among = [...candidates.keys()];
    const problems = 'refused' in r ? r.refused : r.report.problems;
    if (!('refused' in r) && r.report.figures.PASS) {
      final = r;
      break;
    }
    const seams = 'refused' in r ? null : { draft: (r.report.figures.seam_pairs ?? []).map((s) => ({ parts: s.parts, px_over_40: s.px_over_40 })), lattice: latticeSeams };
    const laid = new Map<string, string[]>();
    for (const p of problems) for (const n of partsNamed(p, among, seams)) laid.set(n, [...(laid.get(n) ?? []), problemLine(p)]);
    if (laid.size === 0) for (const n of among) laid.set(n, [`the drafted rig fails a bar that names no part: ${problems.map(problemLine).join('; ')}`]);
    for (const [n, why] of laid) {
      const row = rows.get(n) as PartRow;
      if (row.readings !== null) row.readings.bars = why;
      row.gate = gateVerdict(row.readings ?? { bars: why, idle: 'not measured', bend: 'not measured', triangles: 'not measured' }, input.moreTriangles === true).lines;
      candidates.delete(n);
    }
  }

  // 6. The rows, the notes, the written config.
  const drafted = new Map<string, unknown>();
  for (const row of rows.values()) {
    const cand = candidates.get(row.part);
    if (cand !== undefined && row.readings !== null) {
      row.readings.bars = [];
      const v = gateVerdict(row.readings, input.moreTriangles === true);
      row.gate = v.lines;
      row.mode = 'contour';
      const latticeGrid = row.lattice.grid;
      row.note =
        `drafted by rig-parts mesh-draft in place of the lattice at grid ${latticeGrid}: the traced outline at tolerance and margin ${rules.tolerance}, no outline edge longer than ${rules.spacing} px, the interior grid at spacing ${rules.spacing} (figure ${rules.height} px), ${dustText(row.part)}; ` +
        `held to the lattice: ${v.lines.map((x) => `${x.reading} — ${x.text}`).join('; ')}; ${row.readings.bend === null ? 'measured against the idle only (no chain link, so no bend set)' : MEASURED_SENTENCE}; ${RELATIVE_SENTENCE}; ${CALIBRATED_SENTENCE}`;
      drafted.set(row.part, { ...cand, note: row.note });
    } else if (row.note === '') {
      const failed = row.gate.filter((x) => !x.pass);
      const faint = row.candidate?.bridges?.faint ?? [];
      row.note = `keeps its lattice at grid ${row.lattice.grid}: ${failed.length === 0 ? 'no candidate was read' : failed.map((x) => `${x.reading} — ${x.text}`).join('; ')}${faint.length === 0 ? '' : `; on the bridged candidate those readings read: ${faintText(faint)}`}`;
    }
  }
  const configText = splicedConfig(text, drafted);
  const rowsOut = [...rows.values()];
  const others = notCompared(cfg.meshes);
  const report = {
    spec: MESH_DRAFT_SPEC,
    rules: {
      figure: { top: rules.top, bottom: rules.bottom, height: rules.height },
      tolerance: { value: rules.tolerance, rule: `max(1, round(H / ${TOLERANCE_FIGURE_DIVISOR}))` },
      spacing: { value: rules.spacing, rule: `round(H / ${FIGURE_GRID_DIVISOR})` },
      calibrated_on: CALIBRATION_HEIGHTS,
      dust: { max_px: DUST_MAX_PX, max_share: DUST_MAX_SHARE },
      gate: { more_triangles: input.moreTriangles === true, idle_bound_px: IDLE_BOUND_PX, bend_degrees: BEND_DEGREES, bend_worst_share: BEND_WORST_SHARE, dense_reference: `each candidate part as a lattice at grid max(1, ceil(sqrt(art px / ${DENSE_MAX_SAMPLES})))` },
    },
    lattice_check: barsOf(base.report),
    draft_check: barsOf(final.report),
    figure_overdraw: figureOverdraw(rowsOut),
    parts: rowsOut.map((r) => ({
      part: r.part,
      mode: r.mode,
      lattice: r.lattice,
      candidate: r.candidate === null ? null : { triangles: r.candidate.triangles, overdraw: r.candidate.overdraw, ...(r.candidate.bridges === undefined ? {} : { bridges: r.candidate.bridges }) },
      // Under --more-triangles only: what accepting a costlier candidate trades, triangles against overdraw.
      ...(input.moreTriangles === true && r.candidate !== null ? { delta: { triangles: r.candidate.triangles - r.lattice.triangles, overdraw: pyRound(r.candidate.overdraw - r.lattice.overdraw, 4) } } : {}),
      readings: r.readings,
      gate: r.gate,
      note: r.note,
    })),
    // Issue #307: present only when the config holds an entry that is not a lattice, so a config of lattices alone
    // writes the bytes it wrote before the key existed.
    ...(others.length === 0 ? {} : { not_compared: others }),
  };
  mkdirSync(input.out, { recursive: true });
  const written = [join(input.out, 'config.json'), join(input.out, MESH_DRAFT_REPORT)];
  writeFileSync(written[0], configText);
  writeFileSync(written[1], `${JSON.stringify(report, null, 2)}\n`);
  for (const r of rowsOut) {
    const cand = r.candidate === null ? '' : `; candidate ${r.candidate.triangles} triangle(s), overdraw ${r.candidate.overdraw}${r.candidate.bridges === undefined ? '' : ` (${r.candidate.bridges.joins.length} bridge(s), ${r.candidate.bridges.area_px2} px² over no art: overdraw ${r.candidate.bridges.overdraw} of it${(r.candidate.bridges.faint ?? []).map((f) => `; LEFT OUT faint ${f.art_px} px, brightest alpha ${f.max_alpha} < ${FAINT_ALPHA}`).join('')})`}`;
    log(`  ${r.mode === 'contour' ? 'DRAFTED' : 'LATTICE'}  ${r.part}: lattice grid ${r.lattice.grid} ${r.lattice.triangles} triangle(s), overdraw ${r.lattice.overdraw}${cand}`);
    for (const g of r.gate) log(`    ${g.pass ? 'pass' : 'FAIL'}  ${g.reading}: ${g.text}`);
    if (r.mode === 'grid' && r.gate.length === 0) log(`    ${r.note}`);
  }
  for (const o of others) log(`  NOT COMPARED  ${o.part}: ${o.note}`);
  const nDrafted = rowsOut.filter((r) => r.mode === 'contour').length;
  const tri = (pick: (r: PartRow) => number): number => rowsOut.reduce((a, r) => a + pick(r), 0);
  log(`rig-parts mesh-draft: ${nDrafted} of ${rowsOut.length} lattice part(s) drafted; their triangles ${tri((r) => r.lattice.triangles)} -> ${tri((r) => (r.mode === 'contour' && r.candidate !== null ? r.candidate.triangles : r.lattice.triangles))}, the figure's overdraw over them ${report.figure_overdraw.lattice} -> ${report.figure_overdraw.written}${input.moreTriangles === true ? ` (${MORE_TRIANGLES_FLAG}: triangles reported, not a line)` : ''}${others.length === 0 ? '' : `; ${others.length} part(s) not a lattice, not drafted and not compared: ${others.map((o) => `${o.part} (${o.mode})`).join(', ')}`}; the drafted config's check: ${final.report.figures.PASS ? 'PASS' : 'FAIL'}`);
  if (dirname(resolve(input.config)) !== resolve(input.out)) {
    for (const r of relativeConfigPaths(dirname(resolve(input.config)), raw)) log(`  note: ${r.at} is "${r.value}", relative to the config's directory; the written config keeps the text, so it resolves against ${input.out} — copy the file beside the written config, or the written config beside it`);
  }
  log(`rig-parts mesh-draft: wrote ${written.join(' and ')}`);
  return { rules, rows: rowsOut, notCompared: others, written };
}

/**
 * The figure's overdraw over its lattice parts: Σ mesh area over Σ art px, for the lattices as the config states them
 * and for the meshes the written config holds (a part's overdraw times its art px is its mesh area, to the overdraw's
 * 4 decimals).
 */
export function figureOverdraw(rows: readonly PartRow[]): { lattice: number; written: number; art_px: number } {
  const art = rows.reduce((a, r) => a + r.lattice.art_px, 0);
  const area = (pick: (r: PartRow) => number): number => rows.reduce((a, r) => a + pick(r) * r.lattice.art_px, 0);
  const lattice = area((r) => r.lattice.overdraw);
  const written = area((r) => (r.mode === 'contour' && r.candidate !== null ? r.candidate.overdraw : r.lattice.overdraw));
  return { lattice: art === 0 ? 0 : pyRound(lattice / art, 4), written: art === 0 ? 0 : pyRound(written / art, 4), art_px: art };
}

/** No art-fit bound: the comparison's setup measurement is reported, never gated (`ArtFitBounds`, rig-c). */
const NO_ART_FIT = { minCoverage: 0, maxOvershoot: null, maxUndercut: null };

/** A check report's bars as the mesh-draft report holds them: PASS, and each bar's status. */
function barsOf(r: CheckReport): { PASS: boolean; bars: Record<string, string>; problems: string[] } {
  const bars: Record<string, string> = {};
  for (const b of BARS) bars[b] = r.bars.skipped.some((s) => s.bar === b) ? 'SKIP' : r.problems.some((p) => problemBar(p) === b) ? 'FAIL' : 'PASS';
  return { PASS: r.figures.PASS, bars, problems: r.problems.map(problemLine) };
}

/** The bar a check problem belongs to, by its code. */
function problemBar(p: Problem): string {
  if (p.code === 'CHECK_RIGC_GREEN') return 'gate';
  if (p.code === 'CHECK_LOOP_CLOSES') return 'loop';
  if (p.code === 'CHECK_SEAM_WITHIN_BAR') return 'seam';
  return p.code.replace(/^CHECK_/, '');
}

