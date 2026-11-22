import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PartsError } from '../src/errors.ts';
import { readWrapperLayers } from '../src/layers.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { ALPHA_FLOOR, compareVisibilityDepth, readVisibilityRecord, writeVisibilityRecord } from '../src/visibility.ts';

type Say = (name: string, pass: boolean, detail: string, why: string) => void;

interface FixtureLayer {
  tag: string;
  offset: readonly [number, number];
  size: readonly [number, number];
  alpha: readonly number[];
  depth: readonly number[];
}

const identity = {
  prompt_id: '00000000-0000-4000-8000-000000000001',
  input_sha256: 'a'.repeat(64),
  graph_sha256: 'b'.repeat(64),
};

const manifestPath = 'visibility.json';
const sourcePath = 'layers.json';
const imagePath = (tag: string): string => `parts/${tag}.png`;
const depthPath = (tag: string): string => `parts/${tag}_depth.png`;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function raster(size: FixtureLayer['size'], pixels: readonly number[], scalar = false): Uint8Array {
  return encodePngBytes({
    width: size[0],
    height: size[1],
    data: Uint8ClampedArray.from(pixels.flatMap((value) => scalar ? [value, value, value, 255] : [70, 90, 110, value])),
  });
}

function writeFixture(dir: string, canvas: readonly [number, number], layers: readonly FixtureLayer[]): void {
  mkdirSync(join(dir, 'parts'), { recursive: true });
  const manifest = layers.map(({ tag, offset: [left, top], size: [width, height], alpha, depth }, index) => {
    writeFileSync(join(dir, imagePath(tag)), raster([width, height], alpha));
    writeFileSync(join(dir, depthPath(tag)), raster([width, height], depth, true));
    return {
      name: tag,
      filename: `fixture_${tag}.png`,
      left,
      top,
      right: left + width,
      bottom: top + height,
      depth_median: (index + 1) / (layers.length + 1),
      depth_filename: `fixture_${tag}_depth.png`,
    };
  });
  writeFileSync(join(dir, sourcePath), JSON.stringify({ width: canvas[0], height: canvas[1], layers: manifest }) + '\n');
}

function strip(tag: string, depth: readonly number[], alpha = depth.map(() => 255)): FixtureLayer {
  return { tag, offset: [0, 0], size: [depth.length, 1], alpha, depth };
}

function refusal(run: () => unknown): string {
  try {
    run();
    return 'accepted';
  } catch (error) {
    if (!(error instanceof PartsError)) throw error;
    return error.problems.map((problem) => problem.code).join(',');
  }
}

function plant(file: string, bytes: Uint8Array | string, run: () => unknown): string {
  const original = readFileSync(file);
  try {
    writeFileSync(file, bytes);
    return refusal(run);
  } finally {
    writeFileSync(file, original);
  }
}

export function runVisibilityChecks(dir: string, say: Say): void {
  const offsetDir = join(dir, 'offset');
  // The wrapper's draw order disagrees with per-pixel depth. Both crops span rows.
  // At canvas (1,1) the back alpha is 128. At (2,1) the front alpha is 127.
  const offsetLayers: readonly FixtureLayer[] = [
    { tag: 'back hair', offset: [0, 0], size: [4, 3], alpha: [255, 255, 255, 255, 255, 128, 255, 255, 255, 255, 255, 255], depth: Array<number>(12).fill(20) },
    { tag: 'face', offset: [1, 1], size: [4, 2], alpha: [255, 127, 255, 255, 255, 255, 0, 255], depth: Array<number>(8).fill(10) },
  ];
  writeFixture(offsetDir, [5, 3], offsetLayers);
  const expected = new Map([
    ['back hair', [1, 1, 1, 1, 1, 2, 1, 2, 1, 2, 2, 1]],
    ['face', [1, 0, 1, 1, 1, 1, 0, 1]],
  ]);

  const wrapper = readWrapperLayers(offsetDir);
  say('VSC01_WRAPPER_INPUT_CONTROL', wrapper.canvas.w === 5 && wrapper.canvas.h === 3 &&
    wrapper.layers.map((layer) => layer.name).join(',') === 'face,back hair' &&
    wrapper.layers.every((layer) => layer.depthHint?.filename === `fixture_${layer.name}_depth.png`),
  `wrapper canvas ${wrapper.canvas.w}x${wrapper.canvas.h}, order ${wrapper.layers.map((layer) => layer.name).join(',')}`,
  'the planted PNGs and depth hints are valid wrapper input');

  const written = writeVisibilityRecord(offsetDir, identity);
  const read = readVisibilityRecord(offsetDir, identity);
  const stateBytes = (root: string, record: typeof read, tag: string): Buffer => {
    const layer = record.layers.find((entry) => entry.tag === tag);
    return layer === undefined ? Buffer.alloc(0) : readFileSync(join(root, layer.record.path));
  };
  const offsetStates = [...expected].map(([tag, states]) => ({ tag, states, got: stateBytes(offsetDir, read, tag) }));
  say('VSC02_OPAQUE_OFFSETS_AND_ALPHA_FLOOR', ALPHA_FLOOR === 128 &&
    offsetStates.every(({ states, got }) => got.equals(Buffer.from(states))),
  `alpha floor ${ALPHA_FLOOR}, ${offsetStates.map(({ tag, got }) => `${tag} [${[...got]}]`).join(', ')}`,
  'crop-local row-major states follow the canvas offsets and include alpha 128 while excluding 127');

  const bound = (ref: { path: string; sha256: string }, path: string): boolean =>
    ref.path === path && ref.sha256 === sha256(readFileSync(join(offsetDir, path)));
  say('VSC03_MANIFEST_BINDS_IDENTITY_AND_BYTES', JSON.stringify(written) === JSON.stringify(read) &&
    read.spec === 'rig-parts-visibility/1' && read.prompt_id === identity.prompt_id &&
    read.input_sha256 === identity.input_sha256 && read.graph_sha256 === identity.graph_sha256 &&
    read.canvas.join(',') === '5,3' && read.alpha_floor === 128 && read.depth_tie === 1 &&
    bound(read.layer_manifest, sourcePath) && read.layers.length === offsetLayers.length &&
    new Set(read.layers.map((layer) => layer.record.path)).size === offsetLayers.length &&
    offsetLayers.every((fixture) => {
      const layer = read.layers.find((entry) => entry.tag === fixture.tag);
      return layer !== undefined && layer.offset.join(',') === fixture.offset.join(',') &&
        layer.size.join(',') === fixture.size.join(',') && bound(layer.image, imagePath(fixture.tag)) &&
        bound(layer.depth, depthPath(fixture.tag)) && /^visibility\/\d+\.bin$/.test(layer.record.path) &&
        bound(layer.record, layer.record.path);
    }),
  `${read.spec}, canvas ${read.canvas.join('x')}, ${read.layers.length} layer entries`,
  'write and read agree on the run identity, geometry, canonical paths and on-disk hashes');

  const partial = join(dir, 'partial');
  const truthTop = raster([1, 1], [255]);
  const partialTop = strip('face', [10], [251]);
  writeFixture(partial, [1, 1], [partialTop, strip('back hair', [20])]);
  writeVisibilityRecord(partial, identity);
  const partialRecord = readVisibilityRecord(partial, identity);
  const truthAlpha = decodePngBytes(truthTop, 'opaque truth fixture').data[3];
  const outputAlpha = decodePngBytes(readFileSync(join(partial, imagePath('face'))), 'output fixture').data[3];
  const topState = stateBytes(partial, partialRecord, 'face');
  say('VSC04_PARTIAL_TOP_USES_OUTPUT_ALPHA', truthAlpha === 255 && outputAlpha === 251 && topState.equals(Buffer.from([3])),
    `truth alpha ${truthAlpha}, output alpha ${outputAlpha}, top state [${[...topState]}]`,
    'the synthetic truth has opaque art while the winning output layer has partial alpha');

  const ties = join(dir, 'ties');
  writeFixture(ties, [4, 1], [strip('face', [10, 11, 10, 12]), strip('back hair', [10, 10, 12, 10])]);
  writeVisibilityRecord(ties, identity);
  const tieRecord = readVisibilityRecord(ties, identity);
  const tieFace = stateBytes(ties, tieRecord, 'face');
  const tieBack = stateBytes(ties, tieRecord, 'back hair');
  const compared = [compareVisibilityDepth(10, 10), compareVisibilityDepth(10, 11), compareVisibilityDepth(11, 10),
    compareVisibilityDepth(10, 12), compareVisibilityDepth(12, 10)];
  say('VSC05_EQUAL_AND_ONE_TIE_TWO_DECIDES', compared.join(',') === '0,0,0,-1,1' &&
    tieFace.equals(Buffer.from([4, 4, 1, 2])) && tieBack.equals(Buffer.from([4, 4, 2, 1])),
  `comparisons [${compared}], face [${[...tieFace]}], back hair [${[...tieBack]}]`,
  'equal and adjacent levels tie, and a two-level gap selects the nearer layer in either direction');

  const pairDirs = [join(dir, 'pair-b-nearer'), join(dir, 'pair-c-nearer')];
  const pairTags = ['face', 'back hair', 'topwear'];
  const orders = [[10, 20, 30], [10, 30, 20]];
  const pairStates = orders.map((depths, index) => {
    const root = pairDirs[index];
    writeFixture(root, [1, 1], pairTags.map((tag, i) => strip(tag, [depths[i]])));
    writeVisibilityRecord(root, identity);
    const record = readVisibilityRecord(root, identity);
    return pairTags.map((tag) => [...stateBytes(root, record, tag)]);
  });
  const pairOrder = orders.map(([, b, c]) => compareVisibilityDepth(b, c));
  say('VSC06_GLOBAL_STATES_DO_NOT_ENCODE_OCCLUDED_PAIR_ORDER', pairOrder.join(',') === '-1,1' &&
    pairStates.every((states) => JSON.stringify(states) === '[[1],[2],[2]]'),
  `A/B/C depths ${JSON.stringify(orders)}, B/C comparisons [${pairOrder}], state bytes ${JSON.stringify(pairStates)}`,
  'swapping the two occluded layers changes their pair ordering while the shared top and all three global states stay fixed');

  const duplicate = join(dir, 'duplicate');
  writeFixture(duplicate, [5, 3], offsetLayers);
  writeVisibilityRecord(duplicate, identity);
  const files = [manifestPath, ...read.layers.map((layer) => layer.record.path)];
  say('VSC07_DETERMINISTIC_RECORD_BYTES', files.every((path) => readFileSync(join(offsetDir, path)).equals(readFileSync(join(duplicate, path)))),
    `compared ${files.length} generated files in independent directories`,
    'the manifest and every crop record are byte-identical for identical input files and identity');

  const readOffset = () => readVisibilityRecord(offsetDir, identity);
  const face = read.layers.find((layer) => layer.tag === 'face')!;
  const mutantState = Buffer.from(stateBytes(offsetDir, read, 'face'));
  mutantState[0] = 2;
  const hashPlants = [
    ['VSC08_CHANGED_LAYER_PNG', imagePath('face'), raster([4, 2], [253, 127, 255, 255, 255, 255, 0, 255])],
    ['VSC09_CHANGED_DEPTH_PNG', depthPath('face'), raster([4, 2], [11, 10, 10, 10, 10, 10, 10, 10], true)],
    ['VSC10_CHANGED_STATE_BYTE', face.record.path, mutantState],
    ['VSC11_CHANGED_LAYER_MANIFEST', sourcePath, readFileSync(join(offsetDir, sourcePath), 'utf8') + '\n'],
  ] as const;
  for (const [name, path, bytes] of hashPlants) {
    const code = plant(join(offsetDir, path), bytes, readOffset);
    say(name, code === 'VISIBILITY_HASH', `${path}: ${code}`, 'the reader refuses changed bytes even though the file still has its expected format');
  }

  const malformed = plant(join(offsetDir, manifestPath), JSON.stringify({ ...read, spec: 'rig-parts-visibility/2' }), readOffset);
  say('VSC12_BAD_VISIBILITY_MANIFEST', malformed === 'VISIBILITY_MANIFEST', `changed spec: ${malformed}`,
    'the reader refuses another manifest version');
  const identities = [
    { ...identity, prompt_id: '00000000-0000-4000-8000-000000000002' },
    { ...identity, input_sha256: 'c'.repeat(64) },
    { ...identity, graph_sha256: 'd'.repeat(64) },
  ];
  const mismatches = identities.map((wrong) => refusal(() => readVisibilityRecord(offsetDir, wrong)));
  say('VSC13_WRONG_RUN_IDENTITY', mismatches.every((code) => code === 'VISIBILITY_MANIFEST'),
    `prompt/input/graph mismatch: ${mismatches.join(', ')}`, 'each field independently binds the record to the requested run');

  const missing = join(dir, 'missing');
  writeFixture(missing, [5, 3], offsetLayers);
  unlinkSync(join(missing, depthPath('face')));
  const source = refusal(() => writeVisibilityRecord(missing, identity));
  const published = existsSync(join(missing, manifestPath));
  say('VSC14_MISSING_WRITER_INPUT', source === 'VISIBILITY_SOURCE' && !published,
    `missing ${depthPath('face')}: ${source}, manifest published ${published}`,
    'the writer refuses a declared layer whose canonical writer depth PNG is missing');
}
