/**
 * Issue #996: `assemble.ground`, the busy-ground rules in `paintingEdges`, and the ground WARN.
 *
 * - {@link runGroundConfigChecks}: the field through every config door (good and bad values), the WARN through the
 *   real CLI on the generated assemble fixture, and `plain` declared against absent (byte-identical parts).
 * - {@link runGroundUnitChecks}: the ring share and the WARN's cut-off on hand-made rasters, and the busy rules on a
 *   hand-computable strip next to the plain mutant that takes the ground.
 * - {@link runGroundExampleChecks}: on the fetched public examples, the WARN is silent on every plain painting and
 *   fires on a busy ground planted under two (`fixtures/busy_ground.ts`); on one, the parts under `visible` with the
 *   busy ground declared stay inside the `core` footprint, next to the undeclared mutant that leaks.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assembleConfig, writeAssembleFixture } from '../fixtures/assemble_fixture.ts';
import { plantBusyGround } from '../fixtures/busy_ground.ts';
import { assemble, DEFAULT_SEAM_RULE, GROUND_RING_SHARE_LIMIT, groundRingShare, groundWarning, type PlacedPart, SILHOUETTE_BORDER, sourceInRig, stageFields } from '../src/assemble.ts';
import { loadConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { readLayers } from '../src/layers.ts';
import { EDGE_CONTRAST, paintingEdges } from '../src/paintingedges.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type RGB = readonly [number, number, number];
const ROOT = resolve(import.meta.dir, '..');

/** A W x H raster of one colour, opaque. */
function flat(w: number, h: number, c: RGB): Raster {
  const r = newRaster(w, h);
  for (let p = 0; p < w * h; p++) r.data.set([c[0], c[1], c[2], 255], p * 4);
  return r;
}

/** The ring pixels of a W x H raster in scan order (the outer `SILHOUETTE_BORDER` pixels). */
function ringPixels(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y < SILHOUETTE_BORDER || y >= h - SILHOUETTE_BORDER || x < SILHOUETTE_BORDER || x >= w - SILHOUETTE_BORDER) out.push(y * w + x);
  return out;
}

export function runGroundConfigChecks(dir: string, say: Say): void {
  const base = assembleConfig();
  const cfg = (ground: unknown): Record<string, unknown> => ({ ...base, assemble: { ...(base.assemble as object), ground } });
  const doors = [parseConfig, (c: Record<string, unknown>) => parseEarlyConfig(c, 'assemble'), (c: Record<string, unknown>) => parseEarlyConfig(c, 'layers')];
  const valid = ['plain', 'busy'].flatMap((ground) => doors.map((read) => {
    try { return read(cfg(ground)).assemble.ground === ground; } catch { return false; }
  }));
  say('GC9960_GROUND_READS_AT_EVERY_CONFIG_DOOR', valid.every(Boolean), `both grounds across full, assemble and layers: ${valid.join(',')}`);
  const invalid = ['other', '', 1, null, true].flatMap((value) => doors.map((read) => {
    try { read(cfg(value)); return false; } catch (e) {
      return e instanceof PartsError && e.problems.some((p) => p.code === 'CONFIG_FIELD_TYPE' && p.object === 'config.assemble.ground' && p.detail.includes('plain') && p.detail.includes('busy'));
    }
  }));
  say('GC9961_BAD_GROUND_IS_NAMED_WITH_ALLOWED_VALUES', invalid.every(Boolean), `fifteen invalid value/door controls: ${invalid.join(',')}`);
  say('GC9962_ABSENT_GROUND_STAYS_ABSENT', doors.every((read) => !('ground' in read(base).assemble)), 'no field is synthesized by any config reader');

  // The CLI on the generated fixture: a plain painting is silent; the same painting with a textured border ring warns
  // when the ground is absent or plain, and not when it is declared busy. The WARN never changes the parts.
  writeAssembleFixture(dir);
  const plainPainting = readPng(join(dir, 'painting.png'));
  const busyPainting = readPng(join(dir, 'painting.png'));
  const { width: w, height: h } = busyPainting;
  // The source ring that becomes the rig ring (rig_scale 0.5): its outer 2 * SILHOUETTE_BORDER source px, in a stripe
  // pattern of two colours far from the fixture's own and from each other.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = 2 * SILHOUETTE_BORDER;
      if (y >= b && y < h - b && x >= b && x < w - b) continue;
      const c: RGB = Math.floor((x + y) / 4) % 2 === 0 ? [20, 200, 20] : [200, 20, 200];
      busyPainting.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  }
  writePng(join(dir, 'painting-busy.png'), busyPainting);
  const run = (name: string, config: Record<string, unknown>, painting: string, project: 'core' | 'visible' = 'visible') => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
    const out = join(dir, name);
    const q = spawnSync(process.execPath, [join(ROOT, 'cli.ts'), 'assemble', '--config', join(dir, 'config.json'), '--source', join(dir, painting), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--out', out, '--project', project], { encoding: 'utf8', cwd: ROOT });
    const text = (q.stdout ?? '') + (q.stderr ?? '');
    return { status: q.status, warned: text.includes('WARN  ASSEMBLE_GROUND_PLAIN: config.assemble.ground'), text, out };
  };
  const rows = [
    { name: 'plain-absent', config: base, painting: 'painting.png', warn: false },
    { name: 'busy-absent', config: base, painting: 'painting-busy.png', warn: true },
    { name: 'busy-plain', config: cfg('plain'), painting: 'painting-busy.png', warn: true },
    { name: 'busy-busy', config: cfg('busy'), painting: 'painting-busy.png', warn: false },
  ];
  const got = rows.map((r) => ({ ...r, ...run(r.name, r.config, r.painting) }));
  say(
    'GC9963_GROUND_WARN_FIRES_ON_A_BUSY_RING_UNLESS_DECLARED_BUSY',
    got.every((r) => r.status === 0 && r.warned === r.warn) && plainPainting.width === w,
    JSON.stringify(got.map((r) => ({ name: r.name, status: r.status, warned: r.warned, expected: r.warn, ...(r.status === 0 && r.warned === r.warn ? {} : { text: r.text.slice(-400) }) }))),
  );
  // The WARN's reach: under project: visible, where paintingEdges reads the ground. The same striped ring, field absent,
  // is silent under core (the mutant would be a WARN there) and warns under visible (the positive control).
  const underCore = run('busy-absent-core', base, 'painting-busy.png', 'core');
  const underVisible = run('busy-absent-visible', base, 'painting-busy.png', 'visible');
  say(
    'GC9965_GROUND_WARN_PRINTS_UNDER_VISIBLE_ONLY',
    underCore.status === 0 && !underCore.warned && underVisible.status === 0 && underVisible.warned,
    `striped ring, ground absent: core exit ${underCore.status}, WARN ${underCore.warned}; visible exit ${underVisible.status}, WARN ${underVisible.warned}`,
  );
  // Declared plain is the absent path, byte for byte, under visible.
  const absent = run('plain-absent-again', base, 'painting.png');
  const declared = run('plain-declared', cfg('plain'), 'painting.png');
  const rig = (o: string) => join(o, 'rig');
  const files = existsSync(join(rig(absent.out), 'parts')) ? ['parts.json', 'painting_in_rig.png', ...readdirSync(join(rig(absent.out), 'parts')).map((f) => `parts/${f}`)] : [];
  say(
    'GC9964_DECLARED_PLAIN_WRITES_THE_ABSENT_BYTES',
    absent.status === 0 && declared.status === 0 && files.length > 0 && files.every((f) => existsSync(join(rig(declared.out), f)) && readFileSync(join(rig(absent.out), f)).equals(readFileSync(join(rig(declared.out), f)))),
    `${files.length} part records/PNGs compared under visible`,
  );
}

export function runGroundUnitChecks(say: Say): void {
  // The ring share and the cut-off, on a 64 x 64 white raster (1792 ring px): 35 figure px in the ring read 0.0195
  // (silent), 36 read 0.0201 (WARN). A declared busy ground is never warned.
  {
    const W = 64;
    const H = 64;
    const ring = ringPixels(W, H);
    const withFigure = (k: number): Raster => {
      const r = flat(W, H, [255, 255, 255]);
      for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) r.data.set([40, 40, 160, 255], (y * W + x) * 4);
      for (let i = 0; i < k; i++) r.data.set([40, 40, 160, 255], ring[i] * 4);
      return r;
    };
    const s0 = groundRingShare(withFigure(0));
    const s35 = groundRingShare(withFigure(35));
    const s36 = groundRingShare(withFigure(36));
    const ok =
      ring.length === 1792 &&
      s0 === 0 &&
      Math.abs(s35 - 35 / 1792) < 1e-12 &&
      Math.abs(s36 - 36 / 1792) < 1e-12 &&
      groundWarning(s0, undefined, 'visible') === null &&
      groundWarning(s35, 'plain', 'visible') === null &&
      groundWarning(s36, undefined, 'visible') !== null &&
      groundWarning(s36, 'plain', 'visible') !== null &&
      groundWarning(s36, 'busy', 'visible') === null &&
      groundWarning(0.464, 'busy', 'visible') === null &&
      groundWarning(s36, undefined, 'core') === null &&
      groundWarning(0.464, 'plain', 'core') === null &&
      GROUND_RING_SHARE_LIMIT === 0.02;
    const text = groundWarning(s36, undefined, 'visible')?.detail ?? '';
    say(
      'GU9965_RING_SHARE_AND_CUT_OFF',
      ok && text.startsWith('2.0 % of the border ring is not one colour: either the ground is not plain or the figure crosses the border; if it is the ground, declare assemble.ground: busy'),
      `ring ${ring.length} px; share at 0 / 35 / 36 ring px: ${s0} / ${s35.toFixed(4)} / ${s36.toFixed(4)}; limit ${GROUND_RING_SHARE_LIMIT}; text "${text}"`,
    );
  }

  // The busy rules on a strip. One part, See-through's soft rim over x 8..11 (alpha 200, 140, 100, 50), nothing from
  // x 12. The painting: the part's colour left of x 10, then a gold block to x 14 and navy beyond — a ground of two
  // colours whose border median is the navy, so `paintedFigure` reads the gold as painted and the navy as ground (the
  // shape of a banner on a wall). The plain path takes the gold block as the part's, opaque, outside its support (the
  // mutant); the busy path raises no alpha outside the part's support and reads no ground px that is not a mix of the
  // two colours.
  {
    const W = 24;
    const H = 9;
    const RED: RGB = [200, 0, 0];
    const ramp = (x: number): number => (x <= 7 ? 255 : x === 8 ? 200 : x === 9 ? 140 : x === 10 ? 100 : x === 11 ? 50 : 0);
    const painting = newRaster(W, H);
    const part = newRaster(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c: RGB = x < 10 ? RED : x < 15 ? [236, 196, 48] : [30, 30, 60];
        painting.data.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
        part.data.set([RED[0], RED[1], RED[2], ramp(x)], (y * W + x) * 4);
      }
    }
    const before = part.data.slice();
    const runOn = (ground: 'plain' | 'busy') => {
      const r: Raster = { width: W, height: H, data: new Uint8ClampedArray(before) };
      const e = paintingEdges([r], painting, { painted: Uint8Array.from({ length: W * H }, (_, p) => (p % W < 15 ? 1 : 0)), editable: [true], ground });
      const row = [...Array(W).keys()].map((x) => r.data[(4 * W + x) * 4 + 3]);
      return { e, row };
    };
    const plain = runOn('plain');
    const busy = runOn('busy');
    const raisedOutside = (row: number[]): number => row.filter((a, x) => ramp(x) === 0 && a > 0).length;
    const raisedOnGround = (row: number[]): number => row.filter((a, x) => x >= 10 && a > ramp(x)).length;
    say(
      'GU9966_PLANTED_PLAIN_PATH_TAKES_A_BUSY_GROUND',
      raisedOutside(plain.row) > 0,
      `plain path, FRONT alpha on row 4: ${plain.row.join(',')}; ${raisedOutside(plain.row)} px raised outside the support`,
    );
    say(
      'GU9967_BUSY_PATH_TAKES_NO_GROUND',
      raisedOutside(busy.row) === 0 && raisedOnGround(busy.row) === 0 && busy.e.skipped.support + busy.e.skipped.mix > 0 && busy.row.slice(0, 8).every((a) => a === 255),
      `busy path, FRONT alpha on row 4: ${busy.row.join(',')}; raised outside the support ${raisedOutside(busy.row)}, raised on the ground ${raisedOnGround(busy.row)}; skipped mix ${busy.e.skipped.mix}, support ${busy.e.skipped.support} (half the contrast floor ${EDGE_CONTRAST / 2})`,
    );
    const again = runOn('busy');
    say('GU9968_BUSY_PATH_DETERMINISTIC', again.row.join(',') === busy.row.join(',') && again.e.skipped.mix === busy.e.skipped.mix, 'two busy runs on the same strip write the same row');
  }

  // Positive: under busy, a seam between two parts on a one-colour BEHIND still takes the painting's edge (ED9531's strip).
  {
    const W = 24;
    const H = 9;
    const RED: RGB = [200, 0, 0];
    const BLUE: RGB = [0, 0, 200];
    const ramp = (x: number): number => (x <= 7 ? 255 : x === 8 ? 200 : x === 9 ? 140 : x === 10 ? 100 : x === 11 ? 50 : 0);
    const painting = newRaster(W, H);
    const behind = newRaster(W, H);
    const front = newRaster(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const c = x < 10 ? RED : BLUE;
        painting.data.set([c[0], c[1], c[2], 255], p);
        behind.data.set([BLUE[0], BLUE[1], BLUE[2], 255], p);
        front.data.set([RED[0], RED[1], RED[2], ramp(x)], p);
      }
    }
    paintingEdges([behind, front], painting, { painted: new Uint8Array(W * H).fill(1), editable: [true, true], ground: 'busy' });
    const row = [...Array(W).keys()].map((x) => front.data[(4 * W + x) * 4 + 3]);
    say('GU9969_BUSY_PATH_STILL_RESOLVES_A_SEAM', row.every((a, x) => a === (x < 10 ? 255 : 0)), `FRONT alpha on row 4: ${row.join(',')}`);
  }

  // A seam whose two supports do not overlap (the review's strip): FRONT opaque red at x < 10, BEHIND opaque blue at
  // x >= 10, the painting's boundary at x = 9. Busy refuses BEHIND's raise at x = 9 (outside its support), so FRONT must
  // keep its coverage there; lowering FRONT anyway (the mutant) leaves the column transparent. Plain is the reference.
  {
    const W = 24;
    const H = 9;
    const RED: RGB = [200, 0, 0];
    const BLUE: RGB = [0, 0, 200];
    const runOn = (ground: 'plain' | 'busy') => {
      const painting = newRaster(W, H);
      const behind = newRaster(W, H);
      const front = newRaster(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4;
          const c = x < 9 ? RED : BLUE;
          painting.data.set([c[0], c[1], c[2], 255], p);
          front.data.set([RED[0], RED[1], RED[2], x < 10 ? 255 : 0], p);
          behind.data.set([BLUE[0], BLUE[1], BLUE[2], x >= 10 ? 255 : 0], p);
        }
      }
      paintingEdges([behind, front], painting, { painted: new Uint8Array(W * H).fill(1), editable: [true, true], ground });
      const stack = (p: number): number => {
        const a = front.data[p * 4 + 3] / 255;
        const b = behind.data[p * 4 + 3] / 255;
        return Math.round(255 * (a + b * (1 - a)));
      };
      let holes = 0;
      for (let p = 0; p < W * H; p++) if (stack(p) < 255) holes++;
      const column = [...Array(H).keys()].map((y) => stack(y * W + 9));
      return { holes, column };
    };
    const plain = runOn('plain');
    const busy = runOn('busy');
    say(
      'GU9970_BUSY_REFUSED_BEHIND_FILL_KEEPS_THE_FRONT_COVERAGE',
      busy.column.every((a) => a === 255) && busy.holes === 0 && plain.holes === 0,
      `stack alpha at x = 9 over the rows: busy ${busy.column.join(',')}, plain ${plain.column.join(',')}; px under 255: busy ${busy.holes}, plain ${plain.holes}`,
    );
  }
}

/** Part px with alpha above 8 outside the union of `core`'s parts (alpha above 0), on the rig canvas. */
function outsideFootprint(core: readonly PlacedPart[], other: readonly PlacedPart[], W: number, H: number): number {
  const foot = new Uint8Array(W * H);
  const mark = (parts: readonly PlacedPart[], over: number, into: Uint8Array): void => {
    for (const { image, record } of parts) {
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const rx = record.x + x;
          const ry = record.y + y;
          if (rx < 0 || ry < 0 || rx >= W || ry >= H) continue;
          if (image.data[(y * image.width + x) * 4 + 3] > over) into[ry * W + rx] = 1;
        }
      }
    }
  };
  mark(core, 0, foot);
  const any = new Uint8Array(W * H);
  mark(other, 8, any);
  let k = 0;
  for (let p = 0; p < W * H; p++) if (any[p] === 1 && foot[p] === 0) k++;
  return k;
}

/**
 * The public examples (`examples/<key>/inputs`, fetched). `examples` lists their directories; `heavy` names the one
 * whose busy plant is assembled three times (core, busy declared, undeclared).
 */
export function runGroundExampleChecks(examples: readonly string[], heavy: string | null, say: Say): void {
  const share = (painting: Raster, cfgPath: string): number => {
    const scale = loadConfig(cfgPath).assemble.rig_scale;
    return groundRingShare(sourceInRig(painting, Math.round(painting.width * scale), Math.round(painting.height * scale)));
  };
  const rows = examples.map((ex) => {
    const cfgPath = join(ex, 'config.json');
    const painting = readPng(join(ex, 'inputs', 'painting.png'));
    const plain = share(painting, cfgPath);
    const busy = share(plantBusyGround(painting), cfgPath);
    return { name: ex.split('/').pop() as string, plain, busy };
  });
  say(
    'GD9970_EXAMPLES_PLAIN_SILENT_AND_PLANTED_BUSY_WARNS',
    rows.length > 0 && rows.every((r) => groundWarning(r.plain, undefined, 'visible') === null && groundWarning(r.busy, undefined, 'visible') !== null && groundWarning(r.busy, 'busy', 'visible') === null),
    rows.map((r) => `${r.name}: plain ${r.plain.toFixed(4)}, planted busy ${r.busy.toFixed(4)}`).join('; '),
  );
  if (heavy === null) return;
  const cfg = loadConfig(join(heavy, 'config.json'));
  const source = plantBusyGround(readPng(join(heavy, 'inputs', 'painting.png')));
  const input = { source, full: readLayers(join(heavy, 'inputs', 'layers', 'full')), head: readLayers(join(heavy, 'inputs', 'layers', 'head')), ...stageFields(cfg), seamRule: DEFAULT_SEAM_RULE };
  const core = assemble({ ...input, projectRule: 'core' });
  const [W, H] = core.parts.rig_size;
  const declared = assemble({ ...input, projectRule: 'visible', ground: 'busy' });
  const undeclared = assemble({ ...input, projectRule: 'visible' });
  const outBusy = outsideFootprint(core.images, declared.images, W, H);
  const outPlain = outsideFootprint(core.images, undeclared.images, W, H);
  say('GD9971_PLANTED_UNDECLARED_BUSY_GROUND_LEAKS', outPlain > 0, `${heavy.split('/').pop()} with a planted busy ground, visible, ground absent: ${outPlain} part px outside the core footprint`);
  say('GD9972_DECLARED_BUSY_GROUND_STAYS_IN_THE_CORE_FOOTPRINT', outBusy === 0, `the same, ground busy: ${outBusy} part px outside the core footprint`);
}
