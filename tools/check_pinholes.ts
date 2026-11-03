/**
 * Issue #944: hand-computable controls for `assemble`'s pinhole bar — the
 * measurement (`measurePinholes`), the `pinholes` block of a requirements file,
 * and the bar end to end through `assembleStage`: declared and planted it
 * refuses by name and writes nothing, declared and clean it passes, and
 * undeclared it reports SKIP, never a pass.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, C, FRAMED_HEAD, framedPainting, type Rect, type RunLayerSpec, writeAssembleFixture } from '../fixtures/assemble_fixture.ts';
import { holeBox, measurePinholes, PINHOLES_RULE, type PlacedPart } from '../src/assemble.ts';
import { assembleStage } from '../src/build.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import type { PartRecord } from '../src/parts.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { pinholesProblems, pinholesRequired, readRequirements } from '../src/requirements.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

const WHITE = [255, 255, 255] as const;
const SPEC = 'spine-parts-requirements/1';

/** A 40x40 painting: white page (the border ring's median), a `C` block over [10, 30)^2 and a white square [15, 18)^2 inside it. */
function unitPainting(): Raster {
  const r = newRaster(40, 40);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const block = x >= 10 && x < 30 && y >= 10 && y < 30;
      const ground = x >= 15 && x < 18 && y >= 15 && y < 18;
      r.data.set([...(block && !ground ? C : WHITE), 255], (y * 40 + x) * 4);
    }
  }
  return r;
}

/**
 * One part over [12, 28)^2, alpha 255 but for: the white square [15, 18)^2 and
 * the painted pixel (15, 18) below it (one 10-px opening, 9 px of it ground: a
 * deliberate gap); (22, 22) (a 1-px pinhole); (20, 13) and (21, 13) (a 2-px
 * pinhole); (12, 20) on the part's edge (a notch the outside reaches: no
 * opening); and (25, 25) at alpha 1 (covered: the stack is alpha above 0).
 */
function unitPart(): PlacedPart {
  const image = newRaster(16, 16);
  const zero = new Set<string>(['22,22', '20,13', '21,13', '12,20', '15,18']);
  for (let y = 15; y < 18; y++) for (let x = 15; x < 18; x++) zero.add(`${x},${y}`);
  for (let y = 12; y < 28; y++) {
    for (let x = 12; x < 28; x++) {
      const a = zero.has(`${x},${y}`) ? 0 : x === 25 && y === 25 ? 1 : 255;
      image.data.set([...C, a], ((y - 12) * 16 + (x - 12)) * 4);
    }
  }
  const record = { name: 'body', from: 'full:topwear', x: 12, y: 12, w: 16, h: 16 } as PartRecord;
  return { record, image };
}

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1, colour: C });

/**
 * The end-to-end fixture: `framedPainting` (white page, a `C` block over rig
 * [8, 48)^2 with a white hole over rig [20, 36)^2) and one full-run `topwear`
 * over rig [10, 46)^2 open over [22, 34)^2 — an opening over the white hole,
 * ground, a deliberate gap — and, planted, open at rig (40, 40) too, where
 * the painting is exactly `C` (every source pixel a 2x Lanczos reduction reads
 * for it, 75..86 each way, lies in the block and outside the hole): one 1-px
 * pinhole, its 8 neighbours all `topwear`'s.
 */
function framedRun(planted: boolean): RunLayerSpec[] {
  const ring = [rect(10, 10, 46, 22), rect(10, 22, 22, 34), rect(34, 22, 46, 34)];
  const below = planted ? [rect(10, 34, 46, 40), rect(10, 41, 46, 46), rect(10, 40, 40, 41), rect(41, 40, 46, 41)] : [rect(10, 34, 46, 46)];
  return [{ name: 'topwear', depth: 0.5, rects: [...ring, ...below] }];
}

function requirementsAt(dir: string, name: string, pinholes: unknown): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, `${JSON.stringify({ spec: SPEC, fps: 12, requirements: [], ...(pinholes === undefined ? {} : { pinholes }) })}\n`);
  return path;
}

function refusals(run: () => unknown): Problem[] | null {
  try {
    run();
    return null;
  } catch (err) {
    if (err instanceof PartsError) return [...err.problems];
    throw err;
  }
}

export function runPinholeChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });

  // The measurement, by hand.
  const pins = measurePinholes(unitPainting(), [unitPart()]);
  const read = pins.map((h) => `${h.px} px at ${holeBox(h)} (${h.borders.map((b) => `"${b.part}" ${b.px}`).join(', ')})`);
  say(
    'PH01_A_PINHOLE_IS_AN_ENCLOSED_OPENING_OF_THE_STACK_WHOSE_EVERY_PIXEL_IS_PAINTED',
    read.join(' | ') === '2 px at 20,13 2x1 ("body" 10) | 1 px at 22,22 1x1 ("body" 8)',
    `${pins.length} pinhole(s): ${read.join(' | ') || 'none'}; expected the 2-px pinhole (its box grown by one, 4x3, holds 10 body px) then the 1-px one (8 neighbours), and neither the 10-px opening over the white square (9 of its px are ground), the edge notch (the outside reaches it) nor the alpha-1 pixel (covered)`,
  );
  const covered = unitPart();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (covered.image.data[(y * 16 + x) * 4 + 3] === 0 && !(x >= 3 && x < 6 && y >= 3 && y < 7)) covered.image.data[(y * 16 + x) * 4 + 3] = 255;
  const cleanPins = measurePinholes(unitPainting(), [covered]);
  say('PH02_THE_SAME_STACK_WITH_ONLY_THE_DELIBERATE_GAP_OPEN_HAS_NO_PINHOLE', cleanPins.length === 0, `${cleanPins.length} pinhole(s) with only the white square and the painted pixel under it left open`);

  // The requirements block.
  const shapes: Array<[string, unknown, string[]]> = [
    ['{required: "yes"}', { required: 'yes' }, ['pinholes.required']],
    ['{}', {}, ['pinholes.required']],
    ['{required: true, bar: 0}', { required: true, bar: 0 }, ['pinholes.bar']],
    ['true', true, ['pinholes']],
  ];
  const shapeRows = shapes.map(([label, value, objects]) => {
    const got = pinholesProblems(value, 'pinholes');
    const ok = got.length === objects.length && got.every((p, i) => p.code === 'REQUIREMENTS_FIELD' && p.object === objects[i]);
    return { label, ok, got: got.map((p) => `${p.code} ${p.object}`).join(', ') };
  });
  const on = readRequirements(requirementsAt(dir, 'on', { required: true, note: 'a note is read by nothing' }));
  const off = readRequirements(requirementsAt(dir, 'off', { required: false }));
  const absent = readRequirements(requirementsAt(dir, 'absent', undefined));
  const fromFile = refusals(() => readRequirements(requirementsAt(dir, 'bad', { required: 1 })));
  say(
    'PH03_THE_PINHOLES_BLOCK_TAKES_ONE_BOOLEAN_AND_REFUSES_EVERY_OTHER_SHAPE_BY_NAME',
    shapeRows.every((r) => r.ok) && pinholesRequired(on) && !pinholesRequired(off) && !pinholesRequired(absent) && !('pinholes' in absent) && fromFile !== null && fromFile.length === 1 && fromFile[0].code === 'REQUIREMENTS_FIELD' && fromFile[0].object.endsWith(' pinholes.required'),
    `${shapeRows.map((r) => `${r.label} -> ${r.got || 'nothing'}`).join('; ')}; read: true -> required ${pinholesRequired(on)}, false -> ${pinholesRequired(off)}, absent -> ${pinholesRequired(absent)}; a file with {required: 1} -> ${fromFile === null ? 'read' : fromFile.map((p) => `${p.code} ${p.object}`).join(', ')}`,
  );

  // The bar end to end, through assembleStage.
  const stage = (label: string, planted: boolean, pinholes: unknown): { out: string; lines: string[]; problems: Problem[] | null } => {
    const fixture = join(dir, `fixture-${planted ? 'planted' : 'clean'}`);
    if (!existsSync(fixture)) writeAssembleFixture(fixture, assembleConfig({ plan: [['topwear', 'full', 'topwear']], extend: [] }), framedPainting(), { full: framedRun(planted), head: FRAMED_HEAD });
    const out = join(dir, `out-${label}`);
    const lines: string[] = [];
    const requirements = pinholes === null ? undefined : requirementsAt(dir, `req-${label}`, pinholes);
    const problems = refusals(() =>
      assembleStage(
        { source: join(fixture, 'painting.png'), full: join(fixture, 'full'), head: join(fixture, 'head'), config: join(fixture, 'config.json'), project: 'core', ...(requirements === undefined ? {} : { requirements }) },
        { partsJson: join(out, 'rig', 'parts.json'), partsDir: join(out, 'rig', 'parts'), recomposite: join(out, 'render', 'recomposite_rig.png'), errorMap: join(out, 'render', 'recomposite_error_rig.png') },
        (l) => lines.push(l),
      ),
    );
    return { out, lines, problems };
  };
  const ruleLines = (r: { lines: string[] }): string[] => r.lines.filter((l) => l.startsWith(`${PINHOLES_RULE}: `));

  const red = stage('declared-planted', true, { required: true });
  const redOk =
    red.problems !== null &&
    red.problems.length === 1 &&
    red.problems[0].code === PINHOLES_RULE &&
    red.problems[0].object === 'pinhole 1 of 1 at 40,40 1x1' &&
    red.problems[0].detail.startsWith('is 1 px between "topwear" 8 px — ') &&
    red.problems[0].detail.includes('pinholes.required: true, so 0 pinholes are required') &&
    !existsSync(red.out);
  say(
    'PH04_DECLARED_A_PLANTED_PINHOLE_IS_REFUSED_BY_NAME_WITH_ITS_BOX_PX_AND_PARTS_AND_NOTHING_IS_WRITTEN',
    redOk,
    `${red.problems === null ? 'NOT refused' : red.problems.map((p) => `${p.code}: ${p.object} — ${p.detail.slice(0, 40)}…`).join(' | ')}; output ${existsSync(red.out) ? 'WRITTEN' : 'absent'}`,
  );

  const green = stage('declared-clean', false, { required: true });
  const greenLines = ruleLines(green);
  say(
    'PH05_DECLARED_A_CLEAN_STACK_PASSES_AT_0_AND_ITS_DELIBERATE_GAP_IS_NOT_A_PINHOLE',
    green.problems === null && greenLines.length === 1 && greenLines[0].startsWith(`${PINHOLES_RULE}: PASS — 0 pinholes in the base set's flat parts stack, bar 0`) && existsSync(join(green.out, 'rig', 'parts.json')),
    `${green.problems === null ? 'built' : `refused: ${green.problems.map((p) => p.object).join(', ')}`}; ${greenLines.map((l) => l.slice(0, 90)).join(' | ') || 'no pinhole line'}`,
  );

  const skips = [stage('undeclared-planted', true, null), stage('false-planted', true, { required: false })];
  const skipOk = skips.every((s) => {
    const l = ruleLines(s);
    return s.problems === null && l.length === 1 && l[0].startsWith(`${PINHOLES_RULE}: SKIP — not measured, not a pass: `) && l[0].includes('declare {"pinholes": {"required": true}}') && existsSync(join(s.out, 'rig', 'parts.json'));
  });
  say(
    'PH06_UNDECLARED_OR_FALSE_THE_PLANTED_PINHOLE_IS_A_SKIP_WITH_THE_REMEDY_NEVER_A_PASS',
    skipOk,
    skips.map((s, i) => `${i === 0 ? 'no requirements file' : 'required: false'}: ${s.problems === null ? 'built' : 'REFUSED'}; ${ruleLines(s).map((l) => l.slice(0, 70)).join(' | ') || 'no pinhole line'}`).join('; '),
  );
}
