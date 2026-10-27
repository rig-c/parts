/** Public declaration controls; all artwork is generated flat blocks. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseConfig } from '../src/config.ts';
import { buildRig, buildWaistPairSource, withWaistPivot, withWaistSharedCopy, rigJsonText } from '../src/rig.ts';
import { withAnimations } from '../src/motion.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { packageRigc } from '../src/check.ts';
import { waistSharedCopyFixture } from '../fixtures/waist.ts';

export function runWaistDeclarationChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  const f = waistSharedCopyFixture(), config = parseConfig(f.config), saved = rigJsonText(f.config);
  const make = () => buildRig(config, f.parts, f.images), output = make();
  const request = { ...config.waist!, topOrigin: [20, 4] as const, bottomOrigin: [16, 26] as const, canvas: [64, 64] as const };
  const expected = withWaistSharedCopy(withWaistPivot(buildWaistPairSource(config, f.parts, f.images), request), request);
  say('WDC00_ACCEPTED_STAGES', rigJsonText(output.rig) === rigJsonText(expected.rig) && rigJsonText(output.meshReport) === rigJsonText(expected.meshReport), 'explicit loader path composes the preserved pair/pivot/shared-copy stages');
  say('WDC01_INPUT_IMMUTABLE_DETERMINISTIC', saved === rigJsonText(f.config) && rigJsonText(output.rig) === rigJsonText(make().rig), 'repeat construction leaves the declaration and source untouched');
  const plain = structuredClone(f.config); delete plain.waist;
  const ordinary = buildRig(parseConfig(plain), f.parts, f.images), bottom = ordinary.rig.skins.default.belt.belt;
  say('WDC02_ABSENT_DEFAULT', !('type' in bottom) && !ordinary.rig.bones.some((b) => b.name === request.bone) && ordinary.rig.constraints === undefined, 'even a qualifying top/bottom pair keeps its rigid region and original graph without a declaration');
  const refused = (run: () => unknown, code: string, object?: string): boolean => {
    try { run(); return false; } catch (error) { const text = String(error); return text.includes(code) && (object === undefined || text.includes(object)); }
  };
  for (const [name, value, code, object] of [
    ['NULL', null, 'CONFIG_FIELD_TYPE', 'config.waist'],
    ['MISSING', { top: 'panel' }, 'CONFIG_FIELD_PRESENT', 'config.waist.bottom'],
    ['UNKNOWN', { ...config.waist, gain: 0.25 }, 'CONFIG_KEY_KNOWN', 'config.waist.gain'],
    ['EMPTY', { ...config.waist, bone: '' }, 'CONFIG_FIELD_TYPE', 'config.waist.bone'],
    ['BONE_MISSING', { ...config.waist, upper: 'absent' }, 'CONFIG_WAIST_BINDING', 'config.waist.upper'],
    ['PART_MISSING', { ...config.waist, top: 'absent' }, 'CONFIG_WAIST_BINDING', 'config.waist.top'],
    ['COLLISION', { ...config.waist, bone: 'carrier' }, 'CONFIG_WAIST_NAME_FREE', 'config.waist.bone'],
    ['SAME_BINDING', { ...config.waist, upper: 'pivot' }, 'CONFIG_WAIST_BINDING', 'config.waist.upper'],
  ] as const) say(`WDC03_${name}`, refused(() => parseConfig({ ...f.config, waist: value }), code, object), 'invalid declaration is refused with its field and rule');
  const wrongTag = structuredClone(f.parts); wrongTag.parts[0].from = 'full:handwear';
  say('WDC04_PROVENANCE_REFUSED', refused(() => buildRig(config, wrongTag, f.images), 'RIG_WAIST_DECLARATION'), 'part spelling alone cannot opt unrelated artwork into the accepted construction');
  const wrongBinding = parseConfig({ ...f.config, waist: { ...config.waist, upper: 'pivot', lower: 'carrier' } });
  say('WDC05_PAIR_BINDING_REFUSED', refused(() => buildRig(wrongBinding, f.parts, f.images), 'RIG_WAIST_DECLARATION'), 'declared upper/lower must be the actual two-bone pair');
  const deform = { duration: 1, tracks: [], deform: [{ slot: 'panel', attachment: 'panel', keys: [{ t: 0, vertices: [1, 0] }] }] };
  say('WDC06_IMPORTED_DEFORM_REFUSED', refused(() => withAnimations(output.motion, { probe: deform }), 'RIG_WAIST_COPY_DEFORM'), 'the final serialization hook rejects imported nonzero old-topology top deformation');
  const driven = { duration: 1, tracks: [{ bone: request.bone, property: 'translatex', keys: [{ t: 0, v: [1] }] }] };
  say('WDC07_GENERATED_FRAME_REFUSED', refused(() => withAnimations(output.motion, { probe: driven }), 'RIG_WAIST_MOTION'), 'an imported animation cannot replace the generated frame motion');
  const unchanged = { duration: 1, tracks: [{ bone: 'carrier', property: 'rotate', keys: [{ t: 0, v: [3] }, { t: 1, v: [3] }] }] };
  const merged = withAnimations(output.motion, { probe: unchanged });
  say('WDC08_IMPORTED_KEYS_UNCHANGED', JSON.stringify((merged.animations as Record<string, unknown>).probe) === JSON.stringify(unchanged), 'authored keys stay byte-for-byte in the imported animation object');
  const home = join(dir, 'declared'); mkdirSync(join(home, 'images'), { recursive: true });
  writeFileSync(join(home, 'rig.json'), rigJsonText(output.rig)); writeFileSync(join(home, 'motion.json'), rigJsonText(output.motion));
  for (const [name, image] of output.images) writeFileSync(join(home, 'images', name), encodePngBytes(image));
  const result = spawnSync(packageRigc(resolve(import.meta.dir, '..')), ['build', '--rig', join(home, 'rig.json'), '--motion', join(home, 'motion.json'), '--out', join(home, 'build'), '--profile', 'rig-play', '--pack', '--page-size', '2048'], { encoding: 'utf8' });
  say('WDC09_DECLARED_NATIVE_GATE', result.status === 0 && (result.stdout.match(/^\s*PASS\s+A00_ROUNDTRIP_PARSE\s*$/gm) ?? []).length === 2, result.status === 0 ? 'declared public builder passes compile and packed native round trips' : result.stdout + result.stderr);
}
