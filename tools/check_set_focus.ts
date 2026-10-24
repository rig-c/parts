/** Issue #719: public flat blocks, authored coordinates and pre-output negative controls. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, flatPainting, writeAssembleFixture } from '../fixtures/assemble_fixture.ts';
import { assembleStage, readRigInputs } from '../src/build.ts';
import { loadConfig, parseConfig, parseEarlyConfig, type CharacterConfig } from '../src/config.ts';
import { cropToSpineY, paintingToSetupPoint, setupToPaintingPoint } from '../src/coords.ts';
import { PartsError } from '../src/errors.ts';
import { readParts, serializeParts } from '../src/parts.ts';
import { buildRig, rigJsonText } from '../src/rig.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function refused(run: () => unknown): string {
  try { run(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; }
}

export function writeSetFocusFixture(dir: string): CharacterConfig {
  const raw = assembleConfig({ rigScale: .73, plan: [['panel', 'full', 'headwear']], extend: [] });
  raw.motion = { duration: 1, tracks: [{ bone: 'anchor', prop: 'rotate', amp: 0, period: 1, phase: 0 }] };
  (raw.assemble as Record<string, unknown>).alternates = [
    { name: 'authored', source: 'painting.png', full: 'full', head: 'head', focus: [101.125, 37.375] },
    { name: 'absent', source: 'painting.png', full: 'full', head: 'head' },
  ];
  writeAssembleFixture(dir, raw, flatPainting(124, 128));
  return loadConfig(join(dir, 'config.json'));
}

export function runSetFocusChecks(dir: string, say: Say): void {
  const cfg = writeSetFocusFixture(dir);
  const readRaw = (raw: unknown) => { const path = join(dir, 'reader.json'); writeFileSync(path, JSON.stringify(raw)); return readParts(path); };
  const persist = (c: unknown): void => writeFileSync(join(dir, 'config.json'), JSON.stringify(c, null, 2) + '\n');
  const assemble = (out: string): void => { assembleStage(
    { config: join(dir, 'config.json'), source: join(dir, 'painting.png'), full: join(dir, 'full'), head: join(dir, 'head'), seam: 'near-white', project: 'core' },
    { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') }, () => {}); };
  const out = join(dir, 'out'); assemble(out);
  const input = readRigInputs(join(dir, 'config.json'), out);
  const result = buildRig(input.cfg, input.parts, input.images);
  const focus = result.sets!.sets.authored.focus!;
  // Independent reference uses the pre-existing y-conversion door and literal accepted raster dimensions.
  const expected = [101.125 * (93 / 128) - 46.5, cropToSpineY(37.375 * (90 / 124), 90)];
  const round = setupToPaintingPoint(focus, [128, 124], [93, 90]);
  say('EXACT_RECTANGULAR_TRANSFORM', same(input.parts.rig_size, [93, 90]) && same(focus, expected), JSON.stringify({ focus, expected }));
  say('INVERSE_FLOAT_ROUNDTRIP', Math.max(Math.abs(round[0] - 101.125), Math.abs(round[1] - 37.375)) <= 1e-12, JSON.stringify(round));
  say('NOMINAL_SCALE_AND_UNFLIPPED_DEFECTS_DIFFER', !same(focus, [101.125 * .73 - 46.5, cropToSpineY(37.375 * .73, 90)]) && !same(focus, [expected[0], 37.375 * (90 / 124)]), 'actual raster ratios and y-up, never nominal scale or y-down');
  say('ABSENT_OMITTED_IN_BOTH_OUTPUTS', !Object.hasOwn(result.sets!.sets.absent, 'focus') && !Object.hasOwn(input.parts.alternates![1], 'focus') && !Object.hasOwn(input.parts.alternates![1], 'focus_source_size'), 'no inferred field or zero default');
  say('ONLY_AUTHORED_SOURCE_METADATA', same(input.parts.alternates![0].focus, [101.125, 37.375]) && same(input.parts.alternates![0].focus_source_size, [128, 124]), 'original painting coordinates and measured source size');
  say('PARTS_ROUNDTRIP', serializeParts(readRaw(JSON.parse(serializeParts(input.parts)))) === serializeParts(input.parts), 'conditional record survives the actual reader');
  const reordered = structuredClone(input.parts); reordered.alternates!.reverse();
  say('MATCH_BY_SET_NAME', same(buildRig(input.cfg, reordered, input.images).sets!.sets.authored.focus, focus), 'record order differs from config order');
  const moved = structuredClone(input.cfg); moved.bones = [{ name: 'anchor', parent: 'root', at: [20, 25] }];
  say('NO_BONE_INFERENCE', same(buildRig(moved, input.parts, input.images).sets!.sets.authored.focus, focus), 'bone origin changes without changing authored focus');
  for (const point of [[0, 0], [128, 124]] as [number, number][]) {
    const candidate = structuredClone(cfg); candidate.assemble.alternates![0].focus = point; persist(candidate);
    const edgeOut = join(dir, `edge-${point[0]}`); assemble(edgeOut);
    const edge = readRigInputs(join(dir, 'config.json'), edgeOut);
    const found = buildRig(edge.cfg, edge.parts, edge.images).sets!.sets.authored;
    say(`EDGE_${point[0]}_PRESENT`, Object.hasOwn(found, 'focus') && same(found.focus, paintingToSetupPoint(point, [128, 124], [93, 90])), JSON.stringify(found.focus));
  }
  for (const [label, value] of [['SHORT', [1]], ['LONG', [1, 2, 3]], ['STRING', ['1', 2]], ['NULL', null], ['OBJECT', { x: 1, y: 2 }], ['NAN', [NaN, 2]], ['INFINITY', [1, Infinity]], ['NEGATIVE', [-1, 2]]] as const) {
    const candidate = structuredClone(cfg) as unknown as { assemble: { alternates: Array<Record<string, unknown>> } }; candidate.assemble.alternates[0].focus = value;
    const messages = [refused(() => parseConfig(candidate)), refused(() => parseEarlyConfig(candidate, 'assemble'))];
    say(`BOTH_LOADERS_REFUSE_${label}`, messages.every(s => s.includes('CONFIG_SET_FOCUS') && s.includes('authored') && s.includes('.focus')), messages.join('; '));
  }
  for (const [label, point] of [['RIGHT', [128.001, 2]], ['BOTTOM', [1, 124.001]], ['NEGATIVE', [-.001, 2]], ['MALFORMED', [1]]] as const) {
    const candidate = structuredClone(cfg) as unknown as { assemble: { alternates: Array<Record<string, unknown>> } }; candidate.assemble.alternates[0].focus = point; persist(candidate);
    const badOut = join(dir, `bad-${label}`), message = refused(() => assemble(badOut));
    say(`REFUSE_BEFORE_OUTPUT_${label}`, message.includes('CONFIG_SET_FOCUS') && message.includes('authored') && message.includes('.focus') && !existsSync(badOut), message);
  }
  for (const [label, edit] of [
    ['MISSING_SIZE', (p: typeof input.parts) => { delete p.alternates![0].focus_source_size; }],
    ['WRONG_SIZE', (p: typeof input.parts) => { p.alternates![0].focus_source_size = [127, 124]; }],
    ['OUTSIDE', (p: typeof input.parts) => { p.alternates![0].focus = [129, 2]; }],
  ] as const) {
    const candidate = structuredClone(input.parts); edit(candidate);
    const messages = [refused(() => readRaw(JSON.parse(serializeParts(candidate)))), refused(() => buildRig(input.cfg, candidate, input.images))];
    say(`RECORD_${label}_REFUSED`, messages.every(s => s.includes('CONFIG_SET_FOCUS') && s.includes('authored')), messages.join('; '));
  }
  const removed = structuredClone(cfg); delete removed.assemble.alternates![0].focus;
  say('REMOVAL_REQUIRES_REASSEMBLY', refused(() => buildRig(removed, input.parts, input.images)).includes('CONFIG_SET_FOCUS'), 'stale assembled focus cannot survive config deletion');
  persist(removed); const absentOut = join(dir, 'all-absent'); assemble(absentOut);
  const absent = readRigInputs(join(dir, 'config.json'), absentOut), absentRig = buildRig(absent.cfg, absent.parts, absent.images);
  say('REASSEMBLY_REMOVES_ALL_FOCUS_METADATA', !readFileSync(join(absentOut, 'parts.json'), 'utf8').includes('focus') && !rigJsonText(absentRig.sets).includes('focus'), 'absent means absent in serialized bytes');
  say('FOCUS_CHANGES_NO_RIG_OR_MOTION', rigJsonText(result.rig) === rigJsonText(absentRig.rig) && rigJsonText(result.motion) === rigJsonText(absentRig.motion), 'only conditional metadata and set focus differ');
}
