/** Scalar controls for the actual two blink-still unit region emissions. */
import { splitUnitNeighbourTurnFixture } from '../fixtures/turn_split_unit.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, turnNeighbourMeshes, type MeshAttachment, type RigOutput } from '../src/rig.ts';
import { computeWorldTransforms, toWorld } from '../src/coords.ts';
import { turnTriangleCoordinates } from '../src/turnfield.ts';
import { PartsError } from '../src/errors.ts';
import { buildDepth25DTurn } from '../src/turn.ts';
import { pyRound } from '../src/round.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type Animation = { deform?: Array<{ slot: string; keys: Array<{ vertices?: number[] }> }> };

/** Independent rigid scalar depths: cap9, plate24; outside retains #796. */
export function splitUnitFieldError(b: RigOutput, upperDepth = 9, lowerDepth = 24) {
  const world = computeWorldTransforms(b.rig.bones), att = b.rig.skins.default.neck.neck as MeshAttachment;
  const rows = [20.5, 30.5, 40.5, 43.5, 45.5, 46.5, 47.5, 50.5];
  let upper = 0, lower = 0, outside = 0, lowerOnlyPlant = 0, pairs = 0;
  for (const [name, axis, band] of [['turn', 'x', 15], ['tilt', 'y', 12], ['body_turn', 'x', 15]] as const) {
    const deform = (b.motion.animations[name] as Animation).deform?.find(d => d.slot === 'neck');
    for (const [ki, angle] of [-band, -band / 2, 0, band / 2, band].entries()) {
      const values = deform?.keys[ki].vertices ?? []; let at = 0;
      for (const [vi, row] of att.weights.entries()) for (const w of row) {
        const dx = values[at++] ?? 0, dy = values[at++] ?? 0, frame = world.get(w.bone)!;
        const y = rows[vi < rows.length ? vi : 2 * rows.length - 1 - vi];
        const covered = y >= 40 && (y < 46 || y >= 47), top = y < 46;
        const z = 120 * 40 / 255, own = (name === 'body_turn' ? 24 : 16) + z - pyRound(z, 4);
        const expected = -(covered ? name === 'body_turn' ? top ? upperDepth : lowerDepth : 0
          : (name === 'body_turn' ? w.bone === 'torso' : w.bone === 'crown') ? own : 0) * Math.sin(angle * Math.PI / 180);
        const actualX = frame.a * dx + frame.b * dy, actualY = frame.c * dx + frame.d * dy;
        const residual = Math.max(Math.abs(actualX - (axis === 'x' ? expected : 0)), Math.abs(actualY - (axis === 'y' ? expected : 0)));
        if (!covered) outside = Math.max(outside, residual);
        else if (top) { upper = Math.max(upper, residual); if (name === 'body_turn') lowerOnlyPlant = Math.max(lowerOnlyPlant, Math.abs(actualX + lowerDepth * Math.sin(angle * Math.PI / 180))); }
        else lower = Math.max(lower, residual);
        pairs++;
      }
    }
  }
  return { upper, lower, outside, lowerOnlyPlant, pairs };
}

export function runTurnSplitUnitChecks(say: Say): void {
  const f = splitUnitNeighbourTurnFixture(), cfg = parseConfig(f.config), input = JSON.stringify(f.config);
  const b = buildRig(cfg, f.parts, f.images), error = splitUnitFieldError(b);
  say('BLS01_UPPER_AND_LOWER_COPY_THEIR_OWN_EMITTED_UNIT_DEPTH', error.upper <= 1.1e-6 && error.lower <= 1.1e-6 && error.outside <= 1.1e-6 && error.lowerOnlyPlant > 1, JSON.stringify(error));
  const plain = splitUnitNeighbourTurnFixture(); delete plain.config.turn;
  const p = buildRig(parseConfig(plain.config), plain.parts, plain.images);
  say('BLS02_SPLIT_SETUP_IDLE_ART_AND_INPUT_UNCHANGED', ['topwear', 'topwear_still', 'neck'].every(slot => JSON.stringify(b.rig.skins.default[slot]) === JSON.stringify(p.rig.skins.default[slot]))
    && JSON.stringify(b.motion.animations.idle) === JSON.stringify(p.motion.animations.idle)
    && JSON.stringify(b.images) === JSON.stringify(p.images) && input === JSON.stringify(f.config), 'both region attachments, weighted target bindings, all PNGs, idle and config retained');
  const support = (o = b) => turnNeighbourMeshes(cfg, o.rig, f.parts, new Map(o.images)).filter(m => m.part === 'topwear');
  const normal = support(), reversed = structuredClone(b); reversed.rig.slots.reverse();
  const ordered = (s: typeof normal) => JSON.stringify(s.toSorted((a, b) => a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  say('BLS03_BOTH_PIECES_ARE_ORDER_INDEPENDENT_AND_SUPPORT_ONLY', normal.length === 2 && ordered(normal) === ordered(support(reversed))
    && normal.some(m => m.slot === 'topwear' && m.weights.every(row => row[0].bone === 'plate'))
    && normal.some(m => m.slot === 'topwear_still' && m.weights.every(row => row[0].bone === 'cap'))
    && !Object.values(b.motion.animations).some(a => (a as Animation).deform?.some(d => d.slot === 'topwear_still')), 'lower plate and upper cap are separate rigid support, never promoted to surface targets');
  const neck = reversed.rig.skins.default.neck.neck as MeshAttachment;
  buildDepth25DTurn(reversed.rig, reversed.motion, {
    turn: cfg.turn!, parts: f.parts.parts, images: f.images, regions: cfg.regions, stills: cfg.motion.blink!.still!,
    boneLandmarks: new Map(), hasAlternateFaceSet: false,
    surfaceMeshes: [{ part: 'neck', slot: 'neck', attachment: 'neck', canvas: f.parts.rig_size, weights: neck.weights, triangles: neck.triangles }],
    neighbourMeshes: turnNeighbourMeshes(cfg, reversed.rig, f.parts, new Map(reversed.images)),
  });
  const reverseError = splitUnitFieldError(reversed);
  say('BLS03_REVERSED_SPLIT_TRAVERSAL_EMITS_THE_SAME_FIELD', reverseError.upper <= 1.1e-6 && reverseError.lower <= 1.1e-6 && reverseError.outside <= 1.1e-6, JSON.stringify(reverseError));
  const points = (mesh: typeof normal[number]) => { const world = computeWorldTransforms(b.rig.bones); return mesh.weights.map(row => toWorld(world.get(row[0].bone)!, row[0].x, row[0].y)); };
  const upper = normal.find(m => m.slot === 'topwear_still')!, lower = normal.find(m => m.slot === 'topwear')!;
  // The actual 40x14 upper and 40x22 lower PNGs have PAD4. Source
  // rectangles end/start at row46; padded rectangles would overlap42..50.
  const owns = (m: typeof upper, x: number, y: number) => turnTriangleCoordinates(points(m), m.triangles!, x, y) !== null;
  say('BLS04_TRANSPARENT_PADDING_CANNOT_LEND_THE_OTHER_PIECES_FIELD', owns(upper, 10, 20) && !owns(lower, 10, 20)
    && owns(lower, 10, 16) && !owns(upper, 10, 16), 'setup y20/16 are painting rows44/48: upper-only/lower-only inside the other PNG transparent padding; clear cut row keeps original skin split in BLS01');
  const changed = structuredClone(b), slot = changed.rig.slots.find(s => s.name === 'topwear_still')!;
  const att = changed.rig.skins.default.topwear_still.topwear_still;
  if ('type' in att) throw new Error('split fixture must emit a region');
  changed.rig.skins.default.topwear_still.decoy = { ...att, x: 999 };
  att.x = 3; att.y = -5; att.rotation = 90;
  const emitted = support(changed).find(m => m.slot === 'topwear_still')!;
  const expected = [[6, -21], [0, -21], [0, 11], [6, 11]];
  let geometryError = 0;
  emitted.weights.forEach((row, i) => { geometryError = Math.max(geometryError, Math.abs(row[0].x - expected[i][0]), Math.abs(row[0].y - expected[i][1])); });
  const shown = JSON.stringify(emitted);
  slot.attachment = 'decoy';
  const decoy = support(changed).find(m => m.slot === 'topwear_still')!;
  say('BLS05_SHOWN_REGION_OFFSETS_ROTATION_AND_OWN_IMAGE_SIZE', geometryError <= 1.1e-6 && shown !== JSON.stringify(decoy) && decoy.attachment === 'decoy', `90-degree hand rectangle, nonzero offsets, emitted upper height14 (not full part height20); max local-corner error=${geometryError}`);
  const aliased = structuredClone(b); aliased.rig.stops = [{ chain: 'carriers', links: ['plate', 'cap', 'chest'], against: 'root', at: [0, 0], inward: 0, outward: 60, lower: { inward: 0, outward: 60 } }];
  aliased.rig.slots.filter(s => s.name.startsWith('topwear')).forEach(s => { s.bone += '_d'; });
  aliased.rig.bones.find(b => b.name === 'cap')!.parent = 'chest_d';
  const alias = support(aliased);
  say('BLS06_DECLARED_STOP_ALIASES_AND_PARENT_FRAMES_RESOLVE', alias.length === 2 && alias.every(m => m.weights.every(row => row[0].bone === `${m.slot === 'topwear' ? 'plate' : 'cap'}_d`)), 'support resolves declared draw aliases without rewriting bindings or emitted frames');
  for (const defect of ['lower-slot', 'upper-slot', 'shown-attachment', 'image', 'frame', 'offset', 'rotation', 'size'] as const) {
    const broken = structuredClone(b);
    if (defect === 'lower-slot' || defect === 'upper-slot') broken.rig.slots = broken.rig.slots.filter(s => s.name !== (defect === 'lower-slot' ? 'topwear' : 'topwear_still'));
    if (defect === 'shown-attachment') broken.rig.slots.find(s => s.name === 'topwear_still')!.attachment = 'missing';
    if (defect === 'image') broken.images = broken.images.filter(([n]) => n !== 'topwear_still.png');
    if (defect === 'frame') broken.rig.slots.find(s => s.name === 'topwear_still')!.bone = 'missing';
    if (defect === 'offset' || defect === 'rotation') { const a = broken.rig.skins.default.topwear_still.topwear_still; if ('type' in a) throw new Error('expected region'); if (defect === 'offset') a.x = NaN; else a.rotation = NaN; }
    if (defect === 'size') broken.images = broken.images.map(([n, image]) => [n, n === 'topwear_still.png' ? { ...image, height: 8 } : image]);
    let named = false;
    try { support(broken); } catch (e) { if (e instanceof PartsError) named = e.problems.some(p => p.code === 'RIG_TURN_SURFACE_OVERLAP_SUPPORT' && p.object.includes(defect === 'lower-slot' ? 'topwear' : 'topwear_still')); else throw e; }
    say(`BLS07_MISSING_${defect.toUpperCase().replaceAll('-', '_')}_REFUSED`, named, 'only genuinely missing emitted split support is refused by name');
  }
  const hidden = structuredClone(b); hidden.rig.slots.find(s => s.name === 'topwear_still')!.attachment = null;
  say('BLS08_UNSHOWN_ATTACHMENT_IS_NOT_INVENTED', support(hidden).length === 1, 'an existing slot showing nothing contributes no drawing; absent shown key is covered by BLS07');
  const tilted = splitUnitNeighbourTurnFixture();
  const bones = tilted.config.bones as Array<{ name: string; tip?: number[] }>;
  bones.find(b => b.name === 'cap')!.tip = [40, 38];
  const turned = buildRig(parseConfig(tilted.config), tilted.parts, tilted.images), turnedError = splitUnitFieldError(turned);
  say('BLS10_AUTHORED_TURNED_UPPER_CARRIER_KEEPS_REGION_PLACEMENT_AND_FIELD', turnedError.upper <= 1.1e-6 && turnedError.lower <= 1.1e-6 && turnedError.outside <= 1.1e-6, JSON.stringify(turnedError));
  for (const reference of ['part', 'bone'] as const) {
    const v = splitUnitNeighbourTurnFixture();
    (v.config.turn as { body: { unitDepths: Record<string, number> } }).body.unitDepths = reference === 'part' ? { topwear: 7, plate: 24, cap: 9 } : { plate: 11, cap: 4 };
    const c = buildRig(parseConfig(v.config), v.parts, v.images), e = splitUnitFieldError(c, reference === 'part' ? 7 : 4, reference === 'part' ? 7 : 11);
    say(`BLS09_${reference.toUpperCase()}_UNIT_DEPTH_REFERENCE_USES_RESOLVED_FIELD`, e.upper <= 1.1e-6 && e.lower <= 1.1e-6 && e.outside <= 1.1e-6, JSON.stringify(e));
  }
}
