/**
 * Does the PUBLISHED PACKAGE run on a machine that has never seen this
 * repository?
 *
 *     bun run smoke                      the whole battery, on this tree's tarball
 *     bun run smoke -- --case clean      just the green one
 *     bun run smoke -- --source registry --version 0.1.0 --wait 15
 *     bun run smoke -- --source registry --version 0.1.0 --case clean --alias <name> [--alias <name>…]
 *
 * Four exit codes, because a caller has to be able to tell the outcomes apart
 * without reading prose: **0** every case passed, **1** a case went red —
 * against `--source registry`, the published artifact does not run — **2**
 * nothing ran at all, and **3** the registry never served the version inside
 * `--wait`, which says nothing about the package.
 *
 * Nothing else in this repository asks that question. `prepublishOnly` gates the
 * SOURCE TREE, the `ships` job in `ci.yml` reads packed PATH LISTS, and
 * `release.yml` publishes and never installs. This is the fact about a program:
 * `npm pack`, `npm install` into an empty directory, and real commands run from
 * the install — `--version`, the same `--version` from every other command
 * the package's `bin` declares (the former name kept for the transition), the
 * installed `rigc --version` (which must name
 * the core entry: an install carries no Spine runtime), `layers` on a wrapper
 * directory, `layers` on a PSD, `sheet`, and `check` on a generated two-part
 * rig, which runs every rigc command a build runs — `build --pack`, `render`,
 * `render --geometry`, `render --slot` — through that entry; `compose` of two
 * copies of a generated character the installed `check` passed, with a plate
 * and an interleaved order (issue #74); and the contour
 * mesh (`src/contour.ts`) on a generated block, which reaches rig-c's
 * outline functions through the named entry `rig-c/mesh`; and the
 * automatic mesh mode (`src/automesh.ts`, issue #126) through the installed
 * `rig` command and rigc's gate.
 *
 * 🔒 **Nothing under this repository is on the fixture's path at run time.** The
 * fixture generator below is authored as text into the install directory and
 * imports the package's `src/raster/png.ts` and `ag-psd` as BARE specifiers, so
 * they resolve inside the install or not at all — and the run refuses a
 * resolution that lands anywhere else. The only thing that crosses from the
 * checkout is the tarball this script packed, which is the subject.
 *
 * 🌱 **The plants are part of the tool.** A smoke nobody has seen fail proves a
 * program ran, not that a program was checked, so four of the six cases
 * rebuild the tarball from a PATCHED COPY of the extracted package — a module
 * removed, each of the two dependencies removed, the Spine runtime added — and INVERT the
 * verdict: such a case is green only when the smoke went red at the step it was
 * supposed to, naming what went missing. The worktree is never patched, and a
 * plant that removed nothing is itself a fault.
 *
 * ⏳ **The wait.** A publish returns before the registry serves what it
 * published — npm says so on the way out, with no upper bound — so `--wait
 * <minutes>` keeps asking, 5 s, 10 s, 20 s, then every 30 s, and prints how long
 * it has been asking. A version the registry has not served yet is exit 3 and a
 * message saying the confirmation was NOT taken; only a case going red on an
 * artifact the registry did serve is exit 1. ⚠️ The wait's probe is `npm view
 * <spec> version`, the packument, not the tarball.
 *
 * 🪞 **The aliases.** Each `--alias <name>` (registry only) adds one of the
 * package's other names: after the cases, the same version under that name is
 * asked for within what is left of `--wait` (at least once), both tarballs are
 * fetched from the
 * registry, and `scripts/alias_tarball.ts`'s `compare` holds the alias to the
 * package — every path, every byte, the `name` line of `package.json`
 * excepted. Compared rather than installed a second time: identical files are
 * the stronger claim, and they take seconds. A difference is exit 1; an alias
 * the registry has not served yet is exit 3, and only when no case went red.
 *
 * What it cannot see: the tarball a branch packs is not the tarball npm serves
 * until a publish makes it one (that is `--source registry`), and a green run is
 * one platform's answer, the runner's.
 */
import { findSmokeExecutable, isSmokePathInside, runSmokeCommand } from './smoke_process.ts';
import { checkSmokeProcess } from './check_smoke_process.ts';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AliasTarballError, compareTarballs } from './alias_tarball.ts';

/** The repository this script packs — it is the subject, and nothing else reaches the fixture. */
const ROOT = resolve(import.meta.dir, '..');
/** The package's name, read from the tree's package.json: the directory an install puts it in, the specifier the fixtures import it by, and the registry spec. */
const PACKAGE = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string }).name;
/**
 * The command the install puts on PATH. A scoped package's name is not a command, so the tool's command is its own
 * `bin` entry; every other command the installed package.json declares is run beside it (SMOKE_EVERY_BIN_RUNS_FROM_THE_INSTALL).
 */
const COMMAND = 'rig-parts';

// ---------------------------------------------------------------------------
// the fixture, authored here because the package carries no art
// ---------------------------------------------------------------------------
//
// Three flat-colour layers with known painted-pixel counts, written twice: as
// the ComfyUI wrapper form (layers.json + PNGs, one flat and two under parts/)
// and as a PSD. Nothing about appearance can be claimed from them, and nothing
// is; what they carry is a draw order and three counts the run can check.

const GENERATOR = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeCanvas, writePsd } from 'ag-psd';
import { encodePngBytes } from '${PACKAGE}/src/raster/png.ts';

// \`fileURLToPath\` and not \`new URL(...).pathname\`: a URL path is
// percent-encoded, so the unusual-path case would write into a directory with
// %20 in its name.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(HERE, 'wrapper');
mkdirSync(join(OUT, 'parts'), { recursive: true });

const layers = [
  { name: 'face', left: 8, top: 4, w: 16, h: 12, depth: 0.5, painted: 100, rgb: [230, 200, 180], flat: false },
  { name: 'back hair', left: 4, top: 0, w: 24, h: 20, depth: 0.9, painted: 300, rgb: [60, 40, 90], flat: true },
  { name: 'eyebrow-l', left: 16, top: 6, w: 4, h: 2, depth: 0.2, painted: 5, rgb: [40, 30, 30], flat: false },
];
const raster = (l) => {
  const data = new Uint8ClampedArray(l.w * l.h * 4);
  for (let i = 0; i < l.painted; i++) data.set([...l.rgb, 255], i * 4);
  return { width: l.w, height: l.h, data };
};
const fileOf = (l) => 'smoke_' + l.name.replace(' ', '_') + '.png';
writeFileSync(join(OUT, 'layers.json'), JSON.stringify({
  prefix: 'smoke',
  layers: layers.map((l) => ({ name: l.name, filename: fileOf(l), left: l.left, top: l.top, right: l.left + l.w, bottom: l.top + l.h, depth_median: l.depth })),
  width: 32,
  height: 24,
}, null, 2));
for (const l of layers) writeFileSync(l.flat ? join(OUT, fileOf(l)) : join(OUT, 'parts', l.name + '.png'), encodePngBytes(raster(l)));
writeFileSync(join(HERE, 'painting.png'), encodePngBytes(raster({ w: 32, h: 24, painted: 32 * 24, rgb: [250, 250, 250] })));

initializeCanvas(() => { throw new Error('no canvas'); }, (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
const bottomFirst = [...layers].sort((a, b) => b.depth - a.depth);
const psd = { width: 32, height: 24, children: bottomFirst.map((l) => ({ name: l.name, left: l.left, top: l.top, right: l.left + l.w, bottom: l.top + l.h, imageData: raster(l) })) };
writeFileSync(join(HERE, 'fixture.psd'), new Uint8Array(writePsd(psd, { noBackground: true })));

console.log('RESOLVED ' + import.meta.resolve('${PACKAGE}/src/raster/png.ts'));
console.log('RESOLVED ' + import.meta.resolve('ag-psd'));
`;

// A rig directory as the rig stage writes one, for \`check\`: a 48x80 canvas, one bone, two region parts
// whose alpha ramps to 0 over the outer third of the radius (a hard edge would make the seam a measure of the
// resampler), one idle that moves the root 2 units right and back over a second. Written by the package's own
// modules, so nothing from the checkout reaches it.
const CHECK_RIG_GENERATOR = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cropToSpineY } from '${PACKAGE}/src/coords.ts';
import { serializeParts } from '${PACKAGE}/src/parts.ts';
import { encodePngBytes } from '${PACKAGE}/src/raster/png.ts';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'checkrig');
const W = 48;
const H = 80;
const PARTS = [
  { name: 'back', x: 4, y: 0, w: 30, h: 80, rgb: [200, 60, 40] },
  { name: 'front', x: 18, y: 20, w: 26, h: 40, rgb: [40, 90, 200] },
];
const raster = (p) => {
  const data = new Uint8ClampedArray(p.w * p.h * 4);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const u = (2 * x + 1 - p.w) / p.w;
    const v = (2 * y + 1 - p.h) / p.h;
    const a = Math.max(0, Math.min(1, (1 - Math.sqrt(u * u + v * v)) * 3));
    if (a > 0) data.set([p.rgb[0], Math.round(p.rgb[1] + (60 * y) / p.h), p.rgb[2], Math.round(255 * a)], (y * p.w + x) * 4);
  }
  return { width: p.w, height: p.h, data };
};
mkdirSync(join(DIR, 'images'), { recursive: true });
mkdirSync(join(DIR, 'parts'), { recursive: true });
for (const p of PARTS) {
  writeFileSync(join(DIR, 'images', p.name + '.png'), encodePngBytes(raster(p)));
  writeFileSync(join(DIR, 'parts', p.name + '.png'), encodePngBytes(raster(p)));
}
const stage = { x: -W / 2, y: 0, width: W, height: H };
const rig = {
  spec: 'rigc-rig/1',
  name: 'smoke_probe',
  images: 'images',
  skeleton: stage,
  bones: [{ name: 'root', x: 0, y: 0 }],
  slots: PARTS.map((p) => ({ name: p.name, bone: 'root', attachment: p.name })),
  skins: { default: Object.fromEntries(PARTS.map((p) => [p.name, { [p.name]: { image: p.name + '.png', x: stage.x + p.x + p.w / 2, y: stage.y + cropToSpineY(p.y + p.h / 2, H) } }])) },
};
writeFileSync(join(DIR, 'rig.json'), JSON.stringify(rig, null, 2) + '\\n');
const motion = {
  spec: 'rigc-motion/1',
  archetype: 'smoke_probe',
  cut: 'smoke_probe',
  easings: {},
  groups: {},
  animations: { idle: { duration: 1, loop: true, tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [2] }, { t: 1, v: [0] }] }] } },
};
writeFileSync(join(DIR, 'motion.json'), JSON.stringify(motion, null, 2) + '\\n');
writeFileSync(join(DIR, 'parts.json'), serializeParts({
  rig_size: [W, H],
  scale_rig_per_source: 1,
  parts: PARTS.map((p) => ({
    name: p.name, from: 'full:topwear', x: p.x, y: p.y, w: p.w, h: p.h,
    opaque_px: Array.from(raster(p).data.filter((_, i) => i % 4 === 3)).filter((a) => a > 8).length,
    projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0,
  })),
  ghost_px: {},
}));
`;

// `compose` from the install (issue #74): the check rig's two soft parts as a character laid out where `build --out`
// lays one out (`parts.json`, `parts/`, `rig/`), carried by a `body` bone under root — the scene's root is shared, so a
// character keying root is refused — plus a flat 96x80 plate and a scene placing two copies side by side, ids `a`
// and `b`, with `b`'s back drawn between `a`'s two slots. The character's own check.json is the installed `check`'s.
const SCENE_GENERATOR = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cropToSpineY } from '${PACKAGE}/src/coords.ts';
import { serializeParts } from '${PACKAGE}/src/parts.ts';
import { encodePngBytes } from '${PACKAGE}/src/raster/png.ts';

const HOME = fileURLToPath(new URL('.', import.meta.url));
const DIR = join(HOME, 'scene-character');
const W = 48;
const H = 80;
const PARTS = [
  { name: 'back', x: 4, y: 0, w: 30, h: 80, rgb: [200, 60, 40] },
  { name: 'front', x: 18, y: 20, w: 26, h: 40, rgb: [40, 90, 200] },
];
const raster = (p) => {
  const data = new Uint8ClampedArray(p.w * p.h * 4);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const u = (2 * x + 1 - p.w) / p.w;
    const v = (2 * y + 1 - p.h) / p.h;
    const a = Math.max(0, Math.min(1, (1 - Math.sqrt(u * u + v * v)) * 3));
    if (a > 0) data.set([p.rgb[0], Math.round(p.rgb[1] + (60 * y) / p.h), p.rgb[2], Math.round(255 * a)], (y * p.w + x) * 4);
  }
  return { width: p.w, height: p.h, data };
};
mkdirSync(join(DIR, 'rig', 'images'), { recursive: true });
mkdirSync(join(DIR, 'parts'), { recursive: true });
for (const p of PARTS) {
  writeFileSync(join(DIR, 'rig', 'images', p.name + '.png'), encodePngBytes(raster(p)));
  writeFileSync(join(DIR, 'parts', p.name + '.png'), encodePngBytes(raster(p)));
}
const stage = { x: -W / 2, y: 0, width: W, height: H };
const rig = {
  spec: 'rigc-rig/1',
  name: 'smoke_scene',
  images: 'images',
  skeleton: stage,
  bones: [{ name: 'root', x: 0, y: 0 }, { name: 'body', parent: 'root', x: 0, y: 0 }],
  slots: PARTS.map((p) => ({ name: p.name, bone: 'body', attachment: p.name })),
  skins: { default: Object.fromEntries(PARTS.map((p) => [p.name, { [p.name]: { image: p.name + '.png', x: stage.x + p.x + p.w / 2, y: stage.y + cropToSpineY(p.y + p.h / 2, H) } }])) },
};
writeFileSync(join(DIR, 'rig', 'rig.json'), JSON.stringify(rig, null, 1) + '\\n');
const motion = {
  spec: 'rigc-motion/1',
  archetype: 'smoke_scene',
  cut: 'smoke_scene',
  easings: {},
  groups: {},
  animations: { idle: { duration: 1, loop: true, note: 'smoke', tracks: [{ bone: 'body', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [2] }, { t: 1, v: [0] }] }] } },
};
writeFileSync(join(DIR, 'rig', 'motion.json'), JSON.stringify(motion, null, 1) + '\\n');
writeFileSync(join(DIR, 'parts.json'), serializeParts({
  rig_size: [W, H],
  scale_rig_per_source: 1,
  parts: PARTS.map((p) => ({
    name: p.name, from: 'full:topwear', x: p.x, y: p.y, w: p.w, h: p.h,
    opaque_px: Array.from(raster(p).data.filter((_, i) => i % 4 === 3)).filter((a) => a > 8).length,
    projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0,
  })),
  ghost_px: {},
}));
const plate = new Uint8ClampedArray(2 * W * H * 4);
for (let i = 0; i < 2 * W * H; i++) plate.set([96, 112, 128, 255], i * 4);
writeFileSync(join(HOME, 'plate.png'), encodePngBytes({ width: 2 * W, height: H, data: plate }));
writeFileSync(join(HOME, 'scene.json'), JSON.stringify({
  spec: 'spine-parts-scene/1',
  canvas: { width: 2 * W, height: H },
  plate: { image: 'plate.png', provenance: 'generated' },
  characters: [{ id: 'a', build: 'scene-character', offset: [0, 0] }, { id: 'b', build: 'scene-character', offset: [W, 0] }],
  order: ['a:back', 'b:back', 'a', 'b'],
}, null, 1) + '\\n');
`;

/** The slot order the composed scene above must compile to: the plate, then `a:back`, `b:back`, `a`'s rest, `b`'s rest. */
const EXPECT_SCENE_SLOTS = ['plate', 'a:back', 'b:back', 'a:front', 'b:front'];

// The contour mesh from the install (issue #84): the package's \`src/contour.ts\` imports rigc's outline functions through
// the named entry \`rig-c/mesh\`, which nothing on the CLI's contour-free paths runs, so this is where a rigc that
// moved or narrowed them shows. A 24x16 block at (4, 4) in 32x24, tolerance 0, margin 1, spacing 8: by hand, the block
// grown by its four neighbours' rows and columns, a 12-vertex outline, 6 interior points and 2·18 − 12 − 2 = 22
// triangles (the selftest's CT01).
const CONTOUR_PROBE = `import { contourMesh } from '${PACKAGE}/src/contour.ts';

const alpha = new Uint8Array(32 * 24);
for (let y = 4; y < 20; y++) for (let x = 4; x < 28; x++) alpha[y * 32 + x] = 255;
const m = contourMesh('probe', { width: 32, height: 24, alpha }, { threshold: 8, tolerance: 0, margin: 1, spacing: 8, regions: [] });
console.log('RESOLVED ' + import.meta.resolve('${PACKAGE}/src/contour.ts'));
console.log('RESOLVED ' + import.meta.resolve('rig-c/mesh'));
console.log(Array.isArray(m) ? 'REFUSED ' + JSON.stringify(m) : 'CONTOUR ' + m.hull + ' ' + (m.vertices.length - m.hull) + ' ' + m.triangles.length / 3);
`;
const EXPECT_CONTOUR = 'CONTOUR 12 6 22';

// The automatic mesh mode from the install (issue #126): the rig fixture's two parts — an opaque 16x8 cloth and a 4x2 eye region (one region alone on a page is rigc's A27) — on a 40x40 rig, its
// mesh in \`auto\`, through the installed \`rig-parts rig\` — the contour source, rig-c's \`reduceMesh\` through
// \`rig-c/mesh\`, and the installed rigc's gate, whose launcher runs its core entry in an install with no Spine
// runtime (the rigc-entry step above holds that). Green means the gate passed, the motion gate (rig-c/meshcompare, no runtime) passed, and \`mesh_report.json\` says \`auto\`.
const AUTO_GENERATOR = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeParts } from '${PACKAGE}/src/parts.ts';
import { encodePngBytes } from '${PACKAGE}/src/raster/png.ts';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'auto-character');
mkdirSync(join(DIR, 'parts'), { recursive: true });
const data = new Uint8ClampedArray(16 * 8 * 4);
for (let i = 0; i < 16 * 8; i++) data.set([200, 120, 80, 255], i * 4);
writeFileSync(join(DIR, 'parts', 'cloth.png'), encodePngBytes({ width: 16, height: 8, data }));
writeFileSync(join(DIR, 'parts', 'eye.png'), encodePngBytes({ width: 4, height: 2, data: data.slice(0, 4 * 2 * 4) }));
writeFileSync(join(DIR, 'parts.json'), serializeParts({
  rig_size: [40, 40],
  scale_rig_per_source: 0.5,
  parts: [
    { name: 'cloth', from: 'full:topwear', x: 10, y: 10, w: 16, h: 8, opaque_px: 128, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
    { name: 'eye', from: 'head:face', x: 16, y: 26, w: 4, h: 2, opaque_px: 8, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
  ],
  ghost_px: {},
}));
const fit = { minCoverage: 1, maxOvershoot: 2, maxUndercut: 0 };
writeFileSync(join(DIR, 'config.json'), JSON.stringify({
  key: 'smoke_auto',
  assemble: { rig_scale: 0.5, plan: [['cloth', 'full', 'topwear'], ['eye', 'head', 'face']] },
  bones: [{ name: 'body', parent: 'root', at: [20, 30] }, { chain: 'hem', parent: 'body', points: [[14, 14], [22, 14]], tip: [30, 14] }, { name: 'eye', parent: 'body', at: [17, 28] }],
  meshes: { cloth: { auto: { source: { tolerance: 0, margin: 1, spacing: 4 }, sourceBounds: fit, targets: { artFit: fit, maxBoundaryDeviation: 1 }, influences: { maxInfluences: 4, minWeight: 0 }, budget: { maxCandidates: 200 }, minArtSamples: 1, motion: { maxLocalDeformation: 1 } }, r: 8, segments: ['hem'] } },
  regions: { eye: 'eye' },
  motion: { duration: 4, tracks: [{ chain: 'hem', amps: [1, 2], period: 4, phase: 0, lag: 0.1 }] },
}, null, 1));
`;

/** The draw order both inputs must read back in, and the opaque count of each layer. */
const EXPECT_ORDER = ['back hair', 'face', 'eyebrow-l'];
const EXPECT_OPAQUE: Record<string, number> = { 'back hair': 300, face: 100, 'eyebrow-l': 5 };

// ---------------------------------------------------------------------------
// running things
// ---------------------------------------------------------------------------

interface Ran {
  status: number;
  out: string;
}

const smokePackages: Record<string, string> = { npm: 'npm', rigc: 'rig-c' };

function run(cmd: string, args: string[], cwd: string, env?: Record<string, string | undefined>): Ran {
  return runSmokeCommand(cmd, args, cwd, env, smokePackages);
}

function onPath(cmd: string): string | null {
  return findSmokeExecutable(cmd);
}

const EXIT_GREEN = 0;
const EXIT_RED = 1;
const EXIT_NOTHING_RAN = 2;
const EXIT_NOT_SERVED = 3;
const DEFAULT_WAIT_MINUTES = 15;

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function elapsedText(ms: number): string {
  const whole = Math.round(ms / 1000);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
}

function backoffMs(attempt: number): number {
  return Math.min(5000 * 2 ** (attempt - 1), 30000);
}

function waitForRegistry(spec: string, minutes: number, cwd: string): { served: boolean; attempts: number; ms: number; last: string } {
  const started = Date.now();
  const deadline = started + Math.round(minutes * 60_000);
  let attempts = 0;
  let last = '';
  for (;;) {
    attempts += 1;
    // `--prefer-online`: npm caches a packument, a negative answer included, and
    // a poll reading its own earlier 404 would wait out the whole ceiling.
    const asked = run('npm', ['view', spec, 'version', '--prefer-online'], cwd);
    if (asked.status === 0) return { served: true, attempts, ms: Date.now() - started, last: asked.out.trim() };
    const said = asked.out.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/A complete log of this run/.test(l));
    last = said.find((l) => /\berror code\b/.test(l)) ?? said[0] ?? '';
    const left = deadline - Date.now();
    if (left <= 0) return { served: false, attempts, ms: Date.now() - started, last };
    const nap = Math.min(backoffMs(attempts), left);
    console.log(`  the registry is not serving ${spec} yet — attempt ${attempts}, ${elapsedText(Date.now() - started)} into a ${minutes} min wait; asking again in ${Math.round(nap / 1000)}s`);
    sleepMs(nap);
  }
}

// ---------------------------------------------------------------------------
// the tarball, and the plants that patch a COPY of it
// ---------------------------------------------------------------------------

type Plant = 'none' | 'drop-src-module' | 'drop-rigc' | 'drop-psd' | 'add-spine-core';

/** The runtime the add-spine-core plant puts into the packed package.json's dependencies, at the pin rig-c develops against. */
const SPINE_CORE = '@esotericsoftware/spine-core';
const SPINE_CORE_PIN = '4.3.13';

const PLANTED: Record<Exclude<Plant, 'none'>, { names: string[]; steps: string[]; what: string }> = {
  'drop-src-module': {
    names: ['layers.ts'],
    steps: ['layers'],
    what: '`src/layers.ts` removed from the packed tree. `files` names the `src` DIRECTORY, so a module leaves the package by leaving the tree, and the install is where `layers` cannot find its reader',
  },
  'drop-rigc': {
    names: ['rig-c'],
    steps: ['fixture', 'layers', 'contour', 'auto'],
    what: '`rig-c` removed from `dependencies`. A checkout would not notice — it is already in node_modules — and the install is where the PNG codec, the coordinate door and the contour mesh outline functions have nothing to import',
  },
  'drop-psd': {
    names: ['ag-psd'],
    steps: ['fixture', 'layers'],
    what: '`ag-psd` removed from `dependencies`: the PSD reader is imported by every `layers` call, so the whole command goes, not just the PSD half',
  },
  'add-spine-core': {
    names: ['@esotericsoftware/spine-core'],
    steps: ['rigc-entry'],
    what: "`@esotericsoftware/spine-core` ADDED to `dependencies`: the installed rigc's launcher then finds the runtime and runs cli.ts, the round trip — the shape this repository's CI has, not the shape an install has, so a smoke that cannot tell the two apart would certify the wrong one",
  },
};

function tarPaths(tgz: string, cwd: string): string[] {
  const listed = run('tar', ['-tzf', tgz], cwd);
  if (listed.status !== 0) return [];
  return listed.out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.endsWith('/'))
    .map((l) => (l.startsWith('package/') ? l.slice('package/'.length) : l));
}

function tarballFor(work: string, source: { kind: 'tree' } | { kind: 'registry'; spec: string }, plant: Plant): { tgz: string; faults: string[]; packedPaths: number; evidence: string } {
  const faults: string[] = [];
  const packDir = join(work, 'pack');
  mkdirSync(packDir, { recursive: true });
  const packed =
    source.kind === 'tree'
      ? run('npm', ['pack', ROOT, '--pack-destination', packDir, '--silent'], work)
      : run('npm', ['pack', source.spec, '--pack-destination', packDir, '--silent', '--prefer-online'], work);
  const tarballs = existsSync(packDir) ? readdirSync(packDir).filter((f) => f.endsWith('.tgz')) : [];
  if (packed.status !== 0 || tarballs.length !== 1) {
    faults.push(`SMOKE_PACK_WROTE_A_TARBALL: \`npm pack\` exited ${packed.status} and left ${tarballs.length} tarball(s) in ${packDir}; one was required. ${packed.out.trim()}`);
    return { tgz: '', faults, packedPaths: 0, evidence: '' };
  }
  const first = join(packDir, tarballs[0]);
  const paths = tarPaths(first, work);
  if (plant === 'none') return { tgz: first, faults, packedPaths: paths.length, evidence: '' };

  const patchDir = join(work, 'patched');
  mkdirSync(patchDir, { recursive: true });
  const untar = run('tar', ['-xzf', first, '-C', patchDir], work);
  const pkgDir = join(patchDir, 'package');
  const pkgPath = join(pkgDir, 'package.json');
  if (untar.status !== 0 || !existsSync(pkgPath)) {
    faults.push(`SMOKE_PLANT_APPLIED: extracting ${first} left no package/package.json under ${patchDir}. ${untar.out.trim()}`);
    return { tgz: '', faults, packedPaths: 0, evidence: '' };
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
  if (plant === 'drop-rigc' || plant === 'drop-psd') {
    delete (pkg.dependencies ?? {})[plant === 'drop-rigc' ? 'rig-c' : 'ag-psd'];
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  } else if (plant === 'add-spine-core') {
    pkg.dependencies = { ...(pkg.dependencies ?? {}), [SPINE_CORE]: SPINE_CORE_PIN };
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  } else {
    const victim = join(pkgDir, 'src', 'layers.ts');
    if (!existsSync(victim)) {
      faults.push('SMOKE_PLANT_APPLIED: src/layers.ts is not in the packed tree, so removing it plants nothing');
      return { tgz: '', faults, packedPaths: 0, evidence: '' };
    }
    rmSync(victim);
  }
  const repackDir = join(work, 'repack');
  mkdirSync(repackDir, { recursive: true });
  const repacked = run('npm', ['pack', pkgDir, '--pack-destination', repackDir, '--silent'], work);
  const again = readdirSync(repackDir).filter((f) => f.endsWith('.tgz'));
  if (repacked.status !== 0 || again.length !== 1) {
    faults.push(`SMOKE_PLANT_APPLIED: re-packing the patched copy exited ${repacked.status} with ${again.length} tarball(s). ${repacked.out.trim()}`);
    return { tgz: '', faults, packedPaths: 0, evidence: '' };
  }
  const second = join(repackDir, again[0]);
  // 🚨 The control on the plant itself, read out of the tarball that will be
  // installed: a plant that removed nothing would let the inverted verdict
  // report that a correct package fails.
  const after = tarPaths(second, work);
  let evidence = '';
  if (plant === 'drop-src-module') {
    const gone = paths.filter((p) => !after.includes(p));
    if (gone.length === 0) faults.push(`SMOKE_PLANT_APPLIED: the plant left the packed path list unchanged at ${after.length} path(s)`);
    else evidence = `the plant took ${gone.join(', ')} out of the pack`;
  } else {
    const dep = plant === 'drop-rigc' ? 'rig-c' : plant === 'drop-psd' ? 'ag-psd' : SPINE_CORE;
    const shipped = run('tar', ['-xzOf', second, 'package/package.json'], work);
    const deps = shipped.status === 0 ? ((JSON.parse(shipped.out) as { dependencies?: Record<string, string> }).dependencies ?? {}) : {};
    const applied = plant === 'add-spine-core' ? dep in deps : !(dep in deps);
    if (shipped.status !== 0 || !applied) faults.push(`SMOKE_PLANT_APPLIED: the packed package.json ${plant === 'add-spine-core' ? 'does not declare' : 'still declares'} ${dep}, so nothing was planted`);
    else evidence = `the packed package.json declares ${Object.keys(deps).join(', ') || 'no dependency'}${plant === 'add-spine-core' ? '' : `, without ${dep}`}`;
  }
  return { tgz: second, faults, packedPaths: after.length, evidence };
}

// ---------------------------------------------------------------------------
// one case
// ---------------------------------------------------------------------------

interface CaseSpec {
  name: string;
  source: { kind: 'tree' } | { kind: 'registry'; spec: string };
  installer: 'npm' | 'bun';
  plant: Plant;
  dirName: string;
}

interface CaseResult {
  faults: string[];
  steps: string[];
  notes: string[];
  output: string;
}

/** The rows of a `layers` table: name and opaque count, in the order printed. */
function tableRows(out: string): Array<{ name: string; opaque: number }> {
  const rows: Array<{ name: string; opaque: number }> = [];
  for (const line of out.split('\n')) {
    const m = /^ {2}(\d+) {2}(.+?) {2,}(body|head) {2}/.exec(line);
    if (m === null) continue;
    const cells = line.trim().split(/ {2,}/);
    rows.push({ name: m[2].trim(), opaque: Number(cells[6]) });
  }
  return rows;
}

function runCase(spec: CaseSpec, work: string, keep: boolean): CaseResult {
  const faults: string[] = [];
  const steps: string[] = [];
  const notes: string[] = [];
  let output = '';
  const fault = (step: string, message: string): void => {
    faults.push(message);
    steps.push(step);
  };

  const built = tarballFor(work, spec.source, spec.plant);
  for (const f of built.faults) fault('pack', f);
  if (built.tgz === '') return { faults, steps, notes, output };
  notes.push(`the tarball carries ${built.packedPaths} path(s)`);
  if (built.evidence !== '') notes.push(built.evidence);

  // An EMPTY directory with a package.json of its own, so npm resolves here and
  // does not walk up. `realpathSync` because a module specifier resolves
  // through the real path (macOS reaches its temp dir as /var and reports /private/var).
  mkdirSync(join(work, spec.dirName), { recursive: true });
  const home = realpathSync(join(work, spec.dirName));
  writeFileSync(join(home, 'package.json'), `${JSON.stringify({ name: 'rig-parts-install-smoke', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`);
  const install = spec.installer === 'npm' ? run('npm', ['install', built.tgz, '--no-audit', '--no-fund'], home) : run('bun', ['add', built.tgz], home);
  output += install.out;
  const pkgRoot = join(home, 'node_modules', PACKAGE);
  const bin = join(home, 'node_modules', '.bin', COMMAND);
  if (!existsSync(join(pkgRoot, 'package.json')) || onPath(bin) === null) {
    fault('install', `SMOKE_INSTALL_EMPTY_DIR: ${spec.installer} install of ${built.tgz} exited ${install.status} and left ${existsSync(pkgRoot) ? `no .bin/${COMMAND}` : `no node_modules/${PACKAGE}`} under ${home}. ${install.out.trim().slice(0, 3000)}`);
    if (!keep) rmSync(home, { recursive: true, force: true });
    return { faults, steps, notes, output };
  }
  const installedPkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as { version?: string; bin?: Record<string, string> };
  for (const name of Object.keys(installedPkg.bin ?? {})) smokePackages[name] = PACKAGE;
  const installedVersion = installedPkg.version ?? '';

  // --version, from the install, against the installed package.json.
  const version = run(bin, ['--version'], home);
  output += version.out;
  if (version.status !== 0 || version.out.trim() !== installedVersion) {
    fault('version', `SMOKE_VERSION_FROM_THE_INSTALL: \`${COMMAND} --version\` exited ${version.status} saying ${JSON.stringify(version.out.trim().slice(0, 400))}; the installed package.json says ${installedVersion}`);
  }

  // Every other command the installed package.json's \`bin\` declares — the former
  // name kept for the transition (README, Requirements) — runs too, once, and
  // says the same version. Read off the install, so what is proved is what an
  // upgrade from the former name runs, not what the tree meant to ship.
  const others = Object.keys(installedPkg.bin ?? {}).filter((name) => name !== COMMAND).sort();
  for (const name of others) {
    const other = join(home, 'node_modules', '.bin', name);
    const said = onPath(other) !== null ? run(other, ['--version'], home) : null;
    if (said !== null) output += said.out;
    if (said === null || said.status !== 0 || said.out.trim() !== installedVersion) {
      fault('bin', `SMOKE_EVERY_BIN_RUNS_FROM_THE_INSTALL: the installed package.json declares the command \`${name}\`; ${said === null ? `${spec.installer} left no .bin/${name}` : `\`${name} --version\` exited ${said.status} saying ${JSON.stringify(said.out.trim().slice(0, 400))}`}; exit 0 and ${installedVersion} were required`);
    }
  }
  if (others.length > 0 && !steps.includes('bin')) notes.push(`the command(s) ${others.join(', ')} beside ${COMMAND} ran from the install and said ${installedVersion}`);

  // The installed rigc's entry: neither rig-parts nor rig-c 2.x installs spine-core, so rigc's launcher
  // must find no runtime from its own package root and run cli_core.ts, rigc's own validator.
  const rigcBin = join(home, 'node_modules', '.bin', 'rigc');
  const rigcVersion = onPath(rigcBin) !== null ? run(rigcBin, ['--version'], home) : null;
  if (rigcVersion !== null) output += rigcVersion.out;
  const entryLine = rigcVersion?.out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('entry:')) ?? null;
  if (rigcVersion === null || rigcVersion.status !== 0 || entryLine === null || !/^entry: cli_core\.ts — @esotericsoftware\/spine-core absent — /.test(entryLine)) {
    fault(
      'rigc-entry',
      `SMOKE_RIGC_RUNS_THE_CORE_ENTRY: ${rigcVersion === null ? `no rigc at ${rigcBin}` : `\`rigc --version\` exited ${rigcVersion.status}, entry line ${JSON.stringify(entryLine)}`}; "entry: cli_core.ts — ${SPINE_CORE} absent — …" was required — an install of rig-parts carries no Spine runtime, so its build is gated by rigc's own validator`,
    );
  } else notes.push(`the installed rigc says ${entryLine}`);

  // The fixture: written here, generated by the package's own modules.
  writeFileSync(join(home, 'make_fixture.ts'), GENERATOR);
  const gen = run('bun', [join(home, 'make_fixture.ts')], home);
  output += gen.out;
  if (gen.status !== 0) {
    fault('fixture', `SMOKE_FIXTURE_FROM_THE_PACKAGE: \`bun make_fixture.ts\` exited ${gen.status}. ${gen.out.trim().slice(0, 3000)}`);
  } else {
    const resolved = [...gen.out.matchAll(/^RESOLVED (.+)$/gm)].map((m) => (m[1].startsWith('file://') ? fileURLToPath(m[1]) : m[1]));
    const outsideInstall = resolved.filter((p) => !isSmokePathInside(join(home, 'node_modules'), p));
    if (resolved.length !== 2 || outsideInstall.length > 0) {
      fault('fixture', `SMOKE_FIXTURE_FROM_THE_PACKAGE: the generator's imports resolved to ${resolved.join(', ') || '(nothing)'}; both were required under ${join(home, 'node_modules')}`);
    } else notes.push(`the fixture's codec and PSD writer resolved inside the install`);
  }

  // `layers`, twice: the wrapper form and the PSD form must read back the same
  // draw order and the same opaque counts.
  for (const [label, input] of [
    ['wrapper', join(home, 'wrapper')],
    ['psd', join(home, 'fixture.psd')],
  ] as const) {
    const table = run(bin, ['layers', input], home);
    output += table.out;
    const rows = tableRows(table.out);
    const order = rows.map((r) => r.name).join(' < ');
    const counts = rows.every((r) => EXPECT_OPAQUE[r.name] === r.opaque);
    if (table.status !== 0 || order !== EXPECT_ORDER.join(' < ') || !counts) {
      fault(
        'layers',
        `SMOKE_LAYERS_READS_THE_FIXTURE: \`rig-parts layers\` on the ${label} input exited ${table.status} with order "${order}"${counts ? '' : ` and counts ${rows.map((r) => `${r.name}=${r.opaque}`).join(', ')}`}; "${EXPECT_ORDER.join(' < ')}" with ${Object.entries(EXPECT_OPAQUE).map(([n, c]) => `${n}=${c}`).join(', ')} was required. ${table.out.trim().slice(0, 2000)}`,
      );
    } else notes.push(`layers read the ${label} input: ${order}`);
  }

  // `sheet`, which exercises the resampler, the compositor, rigc's font and the encoder.
  const sheetOut = join(home, 'sheet.png');
  const sheet = run(bin, ['sheet', '--source', join(home, 'painting.png'), '--layers', join(home, 'wrapper'), '--out', sheetOut, '--cell', '60', '--cols', '2'], home);
  output += sheet.out;
  const header = existsSync(sheetOut) ? readFileSync(sheetOut) : null;
  const w = header !== null && header.length >= 24 ? header.readUInt32BE(16) : 0;
  const h = header !== null && header.length >= 24 ? header.readUInt32BE(20) : 0;
  if (sheet.status !== 0 || w !== 120 || h !== 120) {
    fault('sheet', `SMOKE_SHEET_WRITES_ITS_PNG: \`rig-parts sheet\` exited ${sheet.status} and wrote ${header === null ? 'nothing' : `a ${w}x${h} file`}; 120x120 (4 tiles, 2 columns of 60) was required. ${sheet.out.trim().slice(0, 2000)}`);
  } else notes.push('sheet wrote a 120x120 PNG');

  // `check` on a generated two-part rig: every rigc command a build runs, through the entry above.
  writeFileSync(join(home, 'make_checkrig.ts'), CHECK_RIG_GENERATOR);
  const rigGen = run('bun', [join(home, 'make_checkrig.ts')], home);
  output += rigGen.out;
  const checkOut = join(home, 'check-out');
  const check = rigGen.status === 0 ? run(bin, ['check', '--rig', join(home, 'checkrig'), '--out', checkOut], home) : null;
  if (check !== null) output += check.out;
  const checkJson = existsSync(join(checkOut, 'check.json')) ? (JSON.parse(readFileSync(join(checkOut, 'check.json'), 'utf8')) as { PASS?: unknown; rigc_entry?: { entry?: unknown } }) : null;
  if (check === null || check.status !== 0 || !check.out.includes('check: PASS') || checkJson?.PASS !== true || checkJson.rigc_entry?.entry !== 'cli_core.ts') {
    fault(
      'check',
      `SMOKE_CHECK_FROM_THE_INSTALL: ${check === null ? `\`bun make_checkrig.ts\` exited ${rigGen.status}. ${rigGen.out.trim().slice(0, 2000)}` : `\`rig-parts check\` exited ${check.status}; check.json ${checkJson === null ? 'not written' : `PASS ${String(checkJson.PASS)}, rigc_entry ${JSON.stringify(checkJson.rigc_entry)}`}; exit 0, "check: PASS" and rigc_entry cli_core.ts were required. ${check.out.trim().split('\n').filter((l) => l.includes('FAIL')).slice(0, 3).join(' | ').slice(0, 2000)}`}`,
    );
  } else notes.push(`check passed on the generated rig, gated by ${checkJson.rigc_entry?.entry as string}`);

  // `compose` from the install: a generated character checked green by the installed `check`, composed twice.
  writeFileSync(join(home, 'make_scene.ts'), SCENE_GENERATOR);
  const sceneGen = run('bun', [join(home, 'make_scene.ts')], home);
  output += sceneGen.out;
  const character = join(home, 'scene-character');
  const ownCheck = sceneGen.status === 0 ? run(bin, ['check', '--rig', join(character, 'rig'), '--parts', character, '--out', join(character, 'check')], home) : null;
  if (ownCheck !== null) output += ownCheck.out;
  const sceneOut = join(home, 'scene-out');
  const compose = ownCheck !== null && ownCheck.status === 0 ? run(bin, ['compose', '--scene', join(home, 'scene.json'), '--out', sceneOut], home) : null;
  if (compose !== null) output += compose.out;
  const sceneCheck = existsSync(join(sceneOut, 'check', 'check.json')) ? (JSON.parse(readFileSync(join(sceneOut, 'check', 'check.json'), 'utf8')) as { PASS?: unknown; rigc_entry?: { entry?: unknown } }) : null;
  const compiled = existsSync(join(sceneOut, 'check', 'build', 'skeleton.json')) ? ((JSON.parse(readFileSync(join(sceneOut, 'check', 'build', 'skeleton.json'), 'utf8')) as { slots?: Array<{ name: string }> }).slots ?? []).map((s) => s.name) : [];
  if (compose === null || compose.status !== 0 || !existsSync(join(sceneOut, 'scene.json')) || sceneCheck?.PASS !== true || sceneCheck.rigc_entry?.entry !== 'cli_core.ts' || compiled.join(',') !== EXPECT_SCENE_SLOTS.join(',')) {
    fault(
      'compose',
      `SMOKE_COMPOSE_FROM_THE_INSTALL: ${
        compose === null
          ? sceneGen.status !== 0
            ? `\`bun make_scene.ts\` exited ${sceneGen.status}. ${sceneGen.out.trim().slice(0, 2000)}`
            : `the character's own \`rig-parts check\` exited ${ownCheck?.status}. ${(ownCheck?.out ?? '').trim().split('\n').filter((l) => l.includes('FAIL')).slice(0, 3).join(' | ').slice(0, 2000)}`
          : `\`rig-parts compose\` exited ${compose.status}; scene.json ${existsSync(join(sceneOut, 'scene.json')) ? 'written' : 'not written'}; check.json ${sceneCheck === null ? 'not written' : `PASS ${String(sceneCheck.PASS)}, rigc_entry ${JSON.stringify(sceneCheck.rigc_entry)}`}; compiled slots ${compiled.join(', ') || '(none)'}; exit 0, scene.json, PASS, rigc_entry cli_core.ts and slots ${EXPECT_SCENE_SLOTS.join(', ')} were required. ${compose.out.trim().split('\n').filter((l) => l.includes('FAIL')).slice(0, 3).join(' | ').slice(0, 2000)}`
      }`,
    );
  } else notes.push(`compose bound two copies of a checked character with a plate, drawing ${compiled.join(', ')}, gated by ${sceneCheck.rigc_entry?.entry as string}`);

  // The contour mesh, from the install, through rigc's deep path.
  writeFileSync(join(home, 'contour_probe.ts'), CONTOUR_PROBE);
  const probe = run('bun', [join(home, 'contour_probe.ts')], home);
  output += probe.out;
  const probed = [...probe.out.matchAll(/^RESOLVED (.+)$/gm)].map((m) => (m[1].startsWith('file://') ? fileURLToPath(m[1]) : m[1]));
  const strayProbe = probed.filter((p) => !isSmokePathInside(join(home, 'node_modules'), p));
  if (probe.status !== 0 || !probe.out.split('\n').includes(EXPECT_CONTOUR) || probed.length !== 2 || strayProbe.length > 0) {
    fault(
      'contour',
      `SMOKE_CONTOUR_FROM_THE_INSTALL: \`bun contour_probe.ts\` exited ${probe.status}, printed ${JSON.stringify(probe.out.split('\n').find((l) => l.startsWith('CONTOUR') || l.startsWith('REFUSED')) ?? null)} and resolved ${probed.join(', ') || '(nothing)'}; "${EXPECT_CONTOUR}" with both imports under ${join(home, 'node_modules')} was required. ${probe.out.trim().slice(0, 1500)}`,
    );
  } else notes.push(`the contour mesh ran from the install through rig-c/mesh: ${EXPECT_CONTOUR}`);

  // The automatic mesh mode, from the install, through the installed rig command and rigc's gate.
  writeFileSync(join(home, 'make_auto.ts'), AUTO_GENERATOR);
  const autoGen = run('bun', [join(home, 'make_auto.ts')], home);
  output += autoGen.out;
  const autoDir = join(home, 'auto-character');
  const autoRig = autoGen.status === 0 ? run(bin, ['rig', '--config', join(autoDir, 'config.json'), '--parts', autoDir, '--out', join(autoDir, 'rig')], home) : null;
  if (autoRig !== null) output += autoRig.out;
  const autoReport = existsSync(join(autoDir, 'rig', 'mesh_report.json')) ? (JSON.parse(readFileSync(join(autoDir, 'rig', 'mesh_report.json'), 'utf8')) as Array<{ mode?: unknown; vertices?: unknown; deformation?: { verdict?: unknown } }>) : null;
  const autoLine = autoRig?.out.split('\n').find((l) => l.includes('mesh cloth')) ?? '';
  // Issue #126 item 3: the motion gate ran from the install too — rig-c/meshcompare with no Spine runtime — and passed.
  if (autoRig === null || autoRig.status !== 0 || autoReport?.[0]?.mode !== 'auto' || autoReport[0].deformation?.verdict !== 'pass' || !/; motion \S+ <= 1 at idle@/.test(autoLine)) {
    fault(
      'auto',
      `SMOKE_AUTO_MESH_FROM_THE_INSTALL: ${
        autoRig === null
          ? `\`bun make_auto.ts\` exited ${autoGen.status}. ${autoGen.out.trim().slice(0, 1500)}`
          : `\`rig-parts rig\` exited ${autoRig.status}; mesh_report.json ${autoReport === null ? 'not written' : `mode ${JSON.stringify(autoReport[0]?.mode)}`}; exit 0, mode "auto", a motion verdict "pass" and a mesh line reading "motion <value> <= 1 at idle@…" were required. ${autoRig.out.trim().split('\n').filter((l) => /FAIL|rror|rigc/.test(l)).slice(0, 4).join(' | ').slice(0, 1500)}`
      }`,
    );
  } else notes.push(`an auto mesh built from the install, passed the installed rigc's gate and its motion gate: ${autoLine.trim()}`);

  // The shim's own promise: with bun off PATH it says so in one sentence.
  const bunPath = onPath('bun');
  const nodePath = onPath('node');
  if (bunPath === null) notes.push('SKIP the without-bun control: bun is not on PATH in this run');
  else if (nodePath !== null && dirname(nodePath) === dirname(bunPath)) notes.push(`SKIP the without-bun control: node and bun share ${dirname(bunPath)}`);
  else {
    const stripped = (process.env.PATH ?? '').split(delimiter).filter((part) => part !== dirname(bunPath));
    const withoutBun = run(bin, ['--version'], home, { ...process.env, PATH: stripped.join(delimiter) });
    if (withoutBun.status === 0 || !/runs on Bun/.test(withoutBun.out)) {
      fault('shim', `SMOKE_SHIM_NAMES_BUN_WHEN_BUN_IS_ABSENT: with ${dirname(bunPath)} off PATH the shim exited ${withoutBun.status} saying ${JSON.stringify(withoutBun.out.trim().slice(0, 300))}`);
    } else notes.push('with bun off PATH the shim names Bun and stops');
  }

  if (!keep) rmSync(home, { recursive: true, force: true });
  return { faults, steps, notes, output };
}

// ---------------------------------------------------------------------------
// the battery
// ---------------------------------------------------------------------------

const HELP = `rig-parts install smoke — does the published package run in an empty directory?

usage:
  bun run smoke                          every case below, on a tarball packed from this tree
  bun run smoke -- --case clean          one case by name
  bun run smoke -- --source registry --version 0.1.0 [--wait 15]
  bun run smoke -- --source registry --version 0.1.0 --case clean --alias <name> [--alias <name>…]
  bun run smoke -- --installer bun       install with \`bun add\` instead of \`npm install\`
  bun run smoke -- --keep                leave the install directories where they are

--alias <name> is for \`--source registry\` too, once per alias: after the cases,
the same version under each other name the package is published as is asked for
within what is left of --wait (at least once), and its unpacked files are held to
the package's, both fetched from the registry, byte for byte but for the name line
of package.json (scripts/alias_tarball.ts compare).

exit codes:
  0  every case passed
  1  a case went red — against \`--source registry\`, the published artifact does not run —
     or an --alias tarball carries other files or other bytes than the package's
  2  no case ran, so this run measured nothing
  3  the registry did not serve the version — under the name or under an --alias — within
     --wait, so the confirmation was NOT taken

cases:
  clean            a correct package installs; --version, layers (wrapper and PSD), sheet, check, compose, the contour mesh and an auto-mode rig run from it
  unusual-path     the same, installed at an absolute path with spaces and non-ASCII in it
  drop-src-module  src/layers.ts out of the packed tree — the smoke has to go RED naming it
  drop-rigc        rig-c out of \`dependencies\` — the smoke has to go RED naming it
  drop-psd         ag-psd out of \`dependencies\` — the smoke has to go RED naming it
  add-spine-core   @esotericsoftware/spine-core INTO \`dependencies\` — RED at the rigc entry
`;

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return EXIT_GREEN;
  }
  const flag = (name: string): string | null => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 || at === argv.length - 1 ? null : argv[at + 1];
  };
  const keep = argv.includes('--keep');
  const only = flag('case');
  const installer = flag('installer') === 'bun' ? 'bun' : 'npm';
  const sourceKind = flag('source') === 'registry' ? 'registry' : 'tree';
  const pkgVersion = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '';
  const wanted = flag('version') ?? pkgVersion;
  const source: CaseSpec['source'] = sourceKind === 'registry' ? { kind: 'registry', spec: `${PACKAGE}@${wanted}` } : { kind: 'tree' };

  const waitFlag = flag('wait');
  const waitMinutes = waitFlag === null ? DEFAULT_WAIT_MINUTES : Number(waitFlag);
  if (waitFlag !== null && sourceKind !== 'registry') {
    console.log('  FAIL  SMOKE_WAIT_IS_FOR_THE_REGISTRY: --wait is for `--source registry`; a tarball packed from this tree is on disk the moment `npm pack` returns');
    return EXIT_RED;
  }
  if (!Number.isFinite(waitMinutes) || waitMinutes < 0) {
    console.log(`  FAIL  SMOKE_WAIT_IS_FOR_THE_REGISTRY: --wait ${JSON.stringify(waitFlag)} is not a number of minutes`);
    return EXIT_RED;
  }
  // The same rule for the aliases: a tarball this tree packs carries one name, so a
  // run that was given another one and read none would print a confirmation nobody took.
  // `--alias` repeats, once per alias, and each one is confirmed in the order given.
  const aliases: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--alias') continue;
    const name = argv[i + 1];
    if (name === undefined || name.startsWith('--')) {
      console.log('  FAIL  SMOKE_ALIAS_CARRIES_THE_SAME_FILES: --alias needs the other name the package is published as');
      return EXIT_RED;
    }
    aliases.push(name);
  }
  if (aliases.length > 0 && sourceKind !== 'registry') {
    console.log(`  FAIL  SMOKE_ALIAS_CARRIES_THE_SAME_FILES: --alias is for \`--source registry\`. A tarball this tree packs carries one name, ${PACKAGE}, so there is no other tarball here to hold to it`);
    return EXIT_RED;
  }
  const own = aliases.find((name) => name === PACKAGE);
  if (own !== undefined) {
    console.log(`  FAIL  SMOKE_ALIAS_CARRIES_THE_SAME_FILES: --alias ${own} is the name this tree publishes, not another one`);
    return EXIT_RED;
  }
  const twice = aliases.find((name, i) => aliases.indexOf(name) !== i);
  if (twice !== undefined) {
    console.log(`  FAIL  SMOKE_ALIAS_CARRIES_THE_SAME_FILES: --alias ${twice} is given twice, so one confirmation would be printed for two`);
    return EXIT_RED;
  }
  const byHand = `bun run smoke -- --source registry --version ${wanted} --case clean${aliases.map((name) => ` --alias ${name}`).join('')}`;

  console.log(`rig-parts install smoke — ${source.kind === 'tree' ? `a tarball packed from ${ROOT}` : `${source.spec} from the registry`}, installed with ${installer}`);
  for (const tool of ['npm', 'bun', 'tar', 'node']) {
    if (onPath(tool) === null) {
      console.log(`  FAIL  SMOKE_PREREQ_TOOLS_ON_PATH: \`${tool}\` is not on PATH, and this smoke installs and runs a package that needs it`);
      return EXIT_RED;
    }
  }

  checkSmokeProcess();

  let served: { served: boolean; attempts: number; ms: number; last: string } | null = null;
  const waitStarted = Date.now();
  if (source.kind === 'registry') {
    served = waitForRegistry(source.spec, waitMinutes, ROOT);
    if (!served.served) {
      console.log(
        `  FAIL  SMOKE_REGISTRY_SERVED_THE_VERSION: the registry did not serve ${source.spec} within ${waitMinutes} min (${served.attempts} attempt(s), ${elapsedText(served.ms)}) — the confirmation was NOT taken, and nothing here says the package is broken. ` +
          `Re-run it (Actions -> release -> Run workflow, version ${wanted}) or by hand: ${byHand}` +
          (served.last === '' ? '' : `. The last thing npm said was: ${served.last}`),
      );
      return EXIT_NOT_SERVED;
    }
    console.log(`  the registry served ${source.spec} on attempt ${served.attempts}, ${elapsedText(served.ms)} after this run started asking`);
  }

  const battery: CaseSpec[] = [
    { name: 'clean', source, installer, plant: 'none', dirName: 'empty' },
    // A CORRECT package at a path nothing in the tree has seen, so a pass is not
    // a pass about this machine's tidy temp directory.
    { name: 'unusual-path', source, installer, plant: 'none', dirName: 'install smoke ünïcode ñ' },
    { name: 'drop-src-module', source, installer, plant: 'drop-src-module', dirName: 'planted-src' },
    { name: 'drop-rigc', source, installer, plant: 'drop-rigc', dirName: 'planted-rigc' },
    { name: 'drop-psd', source, installer, plant: 'drop-psd', dirName: 'planted-psd' },
    { name: 'add-spine-core', source, installer, plant: 'add-spine-core', dirName: 'planted-spine-core' },
  ];
  const chosen = only === null ? battery : battery.filter((c) => c.name === only);
  if (chosen.length === 0) {
    console.log(`  FAIL  SMOKE_CASE_NAMED: no case is named "${only}" — ${battery.map((c) => c.name).join(', ')}`);
    return EXIT_RED;
  }

  let bad = 0;
  let ran = 0;
  for (const spec of chosen) {
    const work = mkdtempSync(join(tmpdir(), 'rig-parts-smoke-'));
    try {
      const result = runCase(spec, work, keep);
      ran += 1;
      if (spec.plant === 'none') {
        if (result.faults.length === 0) console.log(`  PASS  SMOKE_CASE[${spec.name}]  ${result.notes.join('; ')}`);
        else {
          bad += 1;
          console.log(`  FAIL  SMOKE_CASE[${spec.name}]`);
          for (const f of result.faults) console.log(`          ${f}`);
        }
        continue;
      }
      // 🌱 Inverted: the plant is green when the smoke went red where it said it would, naming what went missing.
      const planted = PLANTED[spec.plant];
      const missed: string[] = [];
      if (result.faults.length === 0) missed.push('the smoke passed on a package the plant broke');
      for (const step of planted.steps) if (!result.steps.includes(step)) missed.push(`no fault came from the ${step} step, where this plant has to bite`);
      const said = `${result.faults.join('\n')}\n${result.output}`;
      for (const name of planted.names) if (!said.includes(name)) missed.push(`nothing in the run named ${name}, so the failure does not say what is missing`);
      if (result.steps.includes('pack')) missed.push('the plant itself did not apply');
      if (missed.length === 0) {
        console.log(`  PASS  SMOKE_PLANT[${spec.name}]  ${planted.what}`);
        for (const note of result.notes) console.log(`          ${note}`);
        for (const f of result.faults.slice(0, 2)) console.log(`          red: ${f.split('\n')[0].slice(0, 300)}`);
      } else {
        bad += 1;
        console.log(`  FAIL  SMOKE_PLANT[${spec.name}]`);
        for (const m of missed) console.log(`          ${m}`);
      }
    } finally {
      if (!keep) rmSync(work, { recursive: true, force: true });
      else console.log(`          kept: ${work}`);
    }
  }
  if (ran === 0) {
    console.log('  FAIL  SMOKE_CASE_NAMED: no case ran, so this run measured nothing');
    return EXIT_NOTHING_RAN;
  }
  const readings =
    served !== null && source.kind === 'registry'
      ? aliases.map((name) => ({ name, reading: confirmAlias(source.spec, `${name}@${wanted}`, Math.max(0, waitMinutes - (Date.now() - waitStarted) / 60_000), waitMinutes, byHand) }))
      : [];
  const aliasRed = readings.some((r) => r.reading === 'differs');
  const aliasLate = readings.some((r) => r.reading === 'late');
  const said = { same: 'carries the same files', differs: 'differs', late: 'was NOT confirmed' } as const;
  const aliasNote = readings.map((r) => `; the alias ${r.name} ${said[r.reading]}`).join('');
  console.log(bad === 0 && !aliasRed && !aliasLate ? `rig-parts install smoke: green — ${ran} case(s)${aliasNote}` : `rig-parts install smoke: ${bad} of ${ran} case(s) failed${aliasNote}`);
  if (bad === 0 && !aliasRed && !aliasLate) return EXIT_GREEN;
  if (bad === 0 && !aliasRed) return EXIT_NOT_SERVED;
  if (bad === 0) return EXIT_RED;
  if (served !== null) {
    console.log(`the published artifact does not run: the registry served ${source.kind === 'registry' ? source.spec : ''} and ${bad} of ${ran} case(s) above went red on it. This is a fault in what was published, not a wait that was too short`);
  }
  return EXIT_RED;
}

/**
 * The alias's confirmation: ask for `aliasSpec` within `leftMinutes` (at least
 * once), fetch it and `packageSpec` from the registry, and hold the one to the
 * other with `compareTarballs`. Prints its own PASS or FAIL line. `late` is a
 * confirmation not taken — the registry did not hand over the alias's bytes —
 * and says nothing about them; `differs` is a fact about what was published.
 */
function confirmAlias(packageSpec: string, aliasSpec: string, leftMinutes: number, waitMinutes: number, byHand: string): 'same' | 'differs' | 'late' {
  const fetchDir = mkdtempSync(join(tmpdir(), 'rig-parts-smoke-alias-'));
  try {
    const got = waitForRegistry(aliasSpec, leftMinutes, fetchDir);
    const fetched = got.served ? [packageSpec, aliasSpec].map((spec, i) => fetchTarball(spec, join(fetchDir, i === 0 ? 'package' : 'alias'))) : [];
    const missing = fetched.map((f) => (typeof f === 'string' ? (existsSync(f) ? null : `${f} is not on disk`) : f.failed)).find((m) => m !== null);
    if (!got.served || missing !== undefined) {
      console.log(
        `  FAIL  SMOKE_ALIAS_CARRIES_THE_SAME_FILES: the registry did not hand over ${aliasSpec} within what was left of the ${waitMinutes} min wait ` +
          `(${got.attempts} attempt(s), ${elapsedText(got.ms)}${got.served ? `; its packument answered and \`npm pack\` did not: ${(missing ?? '').slice(0, 400)}` : ''}) — ` +
          `the alias's confirmation was NOT taken, and nothing here says it differs. Take it by hand once the registry answers: ${byHand}` +
          (got.last === '' || got.served ? '' : `. The last thing npm said was: ${got.last}`),
      );
      return 'late';
    }
    const [packageTgz, aliasTgz] = fetched as string[];
    try {
      const reading = compareTarballs(packageTgz, aliasTgz);
      if (reading.faults.length === 0) {
        console.log(`  PASS  SMOKE_ALIAS_CARRIES_THE_SAME_FILES: the registry served ${aliasSpec} and its ${reading.files} file(s) are ${packageSpec}'s, byte for byte but for the name line of package.json`);
        return 'same';
      }
      console.log(`  FAIL  SMOKE_ALIAS_CARRIES_THE_SAME_FILES: the registry served ${aliasSpec} and it is not ${packageSpec} under another name:`);
      for (const fault of reading.faults) console.log(`          ${fault}`);
      return 'differs';
    } catch (error) {
      if (!(error instanceof AliasTarballError)) throw error;
      console.log(`  FAIL  SMOKE_ALIAS_CARRIES_THE_SAME_FILES: the registry served ${aliasSpec} and it could not be read as a package: ${error.message}`);
      return 'differs';
    }
  } finally {
    rmSync(fetchDir, { recursive: true, force: true });
  }
}

/** `npm pack <spec>` into an empty directory: the one tarball's path, or what npm said when it left none. */
function fetchTarball(spec: string, into: string): string | { failed: string } {
  mkdirSync(into, { recursive: true });
  const packed = run('npm', ['pack', spec, '--pack-destination', into, '--silent', '--prefer-online'], into);
  const made = readdirSync(into).filter((f) => f.endsWith('.tgz'));
  return packed.status === 0 && made.length === 1 ? join(into, made[0]) : { failed: `npm pack ${spec} exited ${packed.status}: ${packed.out.trim()}` };
}

process.exit(main());
