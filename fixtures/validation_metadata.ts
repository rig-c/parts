/** Config/report controls over the original validation sample, with defects. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { buildPrompts, POSITIVE_HEAD, FRAMING } from '../src/graphs.ts';
import { jsonValueSpan, splicedConfig } from '../src/meshdraft.ts';
import { compareStructure, readSkeleton, type StructureComparison } from '../src/structure.ts';
import { SKELETONS } from '../src/skeleton.ts';
import type { ValidationReading } from './validation_readers.ts';

type Raw = Record<string, unknown>;
type Bone = { name?: string; chain?: string; parent: string; at?: number[]; points?: number[][]; tip?: number[]; note?: string };
function read(input: string, file: string): Raw { return JSON.parse(readFileSync(join(input, file), 'utf8')) as Raw; }
function loud(c: StructureComparison, allowed: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const row of c.rows) {
    if (allowed.includes(row.left)) continue;
    if ([row.origin, row.tip, row.length.difference, row.direction].some(f => 'value' in f && f.value !== 0) ||
      !['same', 'roots', 'inserted-right'].includes(row.parent.kind)) out.push(row.left);
  }
  return out;
}
function compare(left: Raw, right: Raw): StructureComparison {
  return compareStructure(readSkeleton(left, 'validation-left'), readSkeleton(right, 'validation-right'), null);
}
function moved(raw: Raw, chain: string): void {
  const bone = (raw.bones as Bone[]).find(b => b.chain === chain);
  if (bone?.points === undefined || bone.tip === undefined) throw new Error('validation move has no chain points');
  bone.points = bone.points.map(p => [p[0] + 1, p[1]]); bone.tip = [bone.tip[0] + 1, bone.tip[1]];
}
function refusal(raw: Raw, field: string): boolean {
  try { readSkeleton(raw, 'validation-proposal'); return false; }
  catch (error) {
    if (!(error instanceof PartsError)) throw error;
    return error.problems.some(p => (p.code === 'CONFIG_NAME_RESOLVES' || p.code === 'CONFIG_KEY_KNOWN') && p.object.endsWith(field));
  }
}

export function validationMetadataReadings(input: string): Record<string, ValidationReading> {
  const config = read(input, 'config.structure.json');
  const authoring = read(input, 'config.authoring.json');
  const proposal = read(input, 'expected/authoring/proposal.json');
  const rig = read(input, 'expected/structure/rig.json');
  const result: Record<string, ValidationReading> = {};
  const cfgRig = compare(config, rig);
  const origins = cfgRig.rows.filter(row => 'value' in row.origin);
  const inserted = cfgRig.rows.flatMap(row => row.parent.kind === 'inserted-right' ? row.parent.between : []);
  const originsMatch = (c: StructureComparison): boolean => c.rows.filter(row => 'value' in row.origin).every(row => 'value' in row.origin && row.origin.value === 0);
  const displacedRig = structuredClone(rig);
  (displacedRig.bones as Array<{ x?: number }>)[1].x = ((displacedRig.bones as Array<{ x?: number }>)[1].x ?? 0) + 1;
  result.stageOrigins = { ok: origins.length === cfgRig.rows.length - 1 && originsMatch(cfgRig) && cfgRig.rows.every(row => ['same', 'roots', 'inserted-right'].includes(row.parent.kind)) && inserted.length > 0 &&
    inserted.every(name => name.endsWith('_ctl')) && cfgRig.unmappedLeft.length === 0 && cfgRig.unmappedRight.join(',') === inserted.join(','),
    defectRefused: !originsMatch(compare(config, displacedRig)), detail: `controls-only structure profile to its actual gated rig: ${origins.length} measured origins, ${inserted.length} inserted controls; +1 rig-bone origin defect detected; ${JSON.stringify({ rows: cfgRig.rows.length, origins: origins.map(row => [row.left, row.origin]), unmappedLeft: cfgRig.unmappedLeft, unmappedRight: cfgRig.unmappedRight, inserted })}` };
  const identical = compare(proposal, authoring);
  result.proposalIdentity = { ok: loud(identical).length === 0 && identical.unmappedLeft.length === 0 && identical.unmappedRight.length === 0,
    defectRefused: false, detail: 'proposal and authoring config have identical normalized bones' };
  const chain = (proposal.bones as Bone[]).find(b => b.chain !== undefined && !b.chain.startsWith('bang'));
  if (chain?.chain === undefined || chain.points === undefined) throw new Error('validation proposal has no chain for its movement control');
  const name = chain.chain;
  const owners = chain.points.map((_, i) => `${name}${i}`);
  const changed = structuredClone(authoring); moved(changed, name);
  const entry = (changed.bones as Bone[]).find(b => b.chain === name) as Bone; entry.note = '#1113 declared fixture movement';
  const acceptsMove = (raw: Raw, drift: readonly string[] = []): boolean => {
    const c = compare(proposal, raw);
    const note = (raw.bones as Bone[]).find(b => b.chain === name)?.note ?? '';
    const differences = loud(c);
    return note.includes('#1113') && owners.every(owner => differences.includes(owner)) &&
      loud(c, [...owners, ...drift]).length === 0 && drift.every(owner => differences.includes(owner)) && c.unmappedLeft.length === 0 && c.unmappedRight.length === 0;
  };
  const noMove = structuredClone(authoring); ((noMove.bones as Bone[]).find(b => b.chain === name) as Bone).note = entry.note;
  const noNote = structuredClone(changed); delete ((noNote.bones as Bone[]).find(b => b.chain === name) as Bone).note;
  result.declaredMove = { ok: acceptsMove(changed), defectRefused: !acceptsMove(noMove) && !acceptsMove(noNote),
    detail: `${name}: every link moved, #1113 note required; restored-points and missing-note defects both refused` };
  result.proposalIdentity.defectRefused = loud(compare(proposal, changed)).length > 0;
  const fringe = (proposal.bones as Bone[]).find(b => b.chain?.startsWith('bang'));
  if (fringe?.chain === undefined || fringe.points === undefined) throw new Error('validation proposal has no fringe chain');
  const drifted = structuredClone(changed); moved(drifted, fringe.chain);
  const driftOwners = fringe.points.map((_, i) => `${fringe.chain}${i}`);
  result.declaredDrift = { ok: acceptsMove(drifted, driftOwners), defectRefused: !acceptsMove(drifted) && !acceptsMove(changed, driftOwners),
    detail: `${fringe.chain}: declared drift must differ; the same drift undeclared, or a stale declaration, is refused` };
  const extra = structuredClone(authoring);
  const head = (extra.bones as Bone[]).find(b => b.name === 'head');
  if (head?.at === undefined) throw new Error('validation proposal has no head anchor');
  (extra.bones as Bone[]).push({ name: 'authored_physics', parent: 'head', at: [...head.at] });
  (extra.constraints as Raw[]).push({ type: 'physics', name: 'authored_physics_constraint', bone: 'authored_physics', rotate: 1 });
  const acceptsExtra = (raw: Raw): boolean => {
    const c = compare(proposal, raw);
    const authored = c.unmappedRight.filter(name => (raw.constraints as Raw[]).some(constraint => constraint.type === 'physics' && constraint.bone === name));
    return loud(c).length === 0 && c.unmappedLeft.length + c.unmappedRight.length === authored.length && authored.length === 1;
  };
  const unexplained = structuredClone(extra); (unexplained.constraints as Raw[]).pop();
  result.authoredPhysics = { ok: acceptsExtra(extra), defectRefused: !acceptsExtra(unexplained), detail: 'one extra physics-owned bone allowed; the identical extra bone without its constraint is refused' };
  const missingConstraint = structuredClone(proposal); (missingConstraint.constraints as Raw[])[0].bone = 'missing';
  const missingLimb = structuredClone(proposal);
  const limbs = missingLimb.limbs as Record<string, { segments: Array<{ bone: string }> }>;
  const firstLimb = Object.keys(limbs)[0]; limbs[firstLimb].segments[0].bone = 'missing';
  const hasBoth = proposal.limbs !== undefined && (proposal.constraints as unknown[]).length > 0 && readSkeleton(proposal, 'validation-proposal').form === 'proposal';
  result.proposalLoader = { ok: hasBoth, defectRefused: refusal(missingConstraint, 'proposal.constraints[0].bone') && refusal(missingLimb, `proposal.limbs.${firstLimb}.segments[0].bone`) && refusal({ ...proposal, drape: 1 }, 'proposal.drape'),
    detail: 'real keypoint/cloth proposal has limbs and constraints; each missing named bone is refused' };
  const text = readFileSync(join(input, 'config.json'), 'utf8');
  const mesh = (config.meshes as Record<string, Raw>).topwear;
  const replacement = { ...mesh, r: Number(mesh.r) + 1 };
  const span = jsonValueSpan(text, ['meshes', 'topwear']);
  const written = splicedConfig(text, new Map([['topwear', replacement]]));
  const acceptsText = (value: string): boolean => {
    const changedSpan = jsonValueSpan(value, ['meshes', 'topwear']);
    return value.slice(0, changedSpan.start) === text.slice(0, span.start) && value.slice(changedSpan.end) === text.slice(span.end) &&
      JSON.stringify((JSON.parse(value) as { meshes: Raw }).meshes.topwear) === JSON.stringify(replacement);
  };
  result.configText = { ok: splicedConfig(text, new Map()) === text && acceptsText(written), defectRefused: !acceptsText(written + ' '),
    detail: 'real sample text: only topwear value spliced; unchanged write exact; whitespace outside its span refused' };
  const generation = parseConfig(config).generation;
  if (generation === undefined) throw new Error('validation has no generation record');
  const terms = (text: string): string[] => text.split(',').map(term => term.trim()).filter(Boolean);
  const known = new Set([POSITIVE_HEAD, generation.trigger, generation.identity, generation.costume, generation.pose ?? '', generation.style].flatMap(terms));
  const traceable = (text: string): boolean => terms(text).every(term => known.has(term));
  const prompt = buildPrompts(generation).positive;
  const noPoseRaw = structuredClone(config);
  const noPoseGeneration = noPoseRaw.generation as Raw;
  delete noPoseGeneration.pose;
  noPoseGeneration.control = { ...(noPoseGeneration.control as Raw), skeleton: 'stand_sides' };
  const noPose = parseConfig(noPoseRaw).generation;
  if (noPose === undefined) throw new Error('validation prompt derivative has no generation');
  const skeletal = buildPrompts(noPose);
  const skeletalKnown = new Set([POSITIVE_HEAD, noPose.trigger, noPose.identity, noPose.costume, FRAMING, SKELETONS.stand_sides.words, noPose.style].flatMap(terms));
  const skeletalTraceable = (text: string): boolean => terms(text).every(term => skeletalKnown.has(term));
  result.prompt = { ok: traceable(prompt) && skeletal.poseFrom === 'the stand_sides skeleton' && skeletalTraceable(skeletal.positive),
    defectRefused: !traceable(prompt + ', long robe to the ankles') && !skeletalTraceable(skeletal.positive + ', long robe to the ankles'),
    detail: 'declared-pose sample and its no-pose/built-in-control derivative use only declared sources; appended costume words refused in both' };
  return result;
}
