import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePngBytes } from '../src/raster/png.ts';

export function runExternalReceiptChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  mkdirSync(join(dir, 'out'), { recursive: true });
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dir, '../cli.ts'), 'external-receipt', ...args],
    { cwd: dir, encoding: 'utf8' });
  const png = (width: number, pixels: number[]) => encodePngBytes({ width, height: 1, data: Uint8ClampedArray.from(pixels) });
  const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
  const mask = png(2, [...black, ...white]), painting = png(2, [...white, ...black]);
  const short = png(1, white), gray = png(2, [...white, 128, 128, 128, 255]);
  for (const [name, bytes] of [['mask.png', mask], ['painting.png', painting], ['short.png', short], ['gray.png', gray], ['bad.png', 'not a PNG']] as const) {
    writeFileSync(join(dir, name), bytes);
  }
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const digest = 'a'.repeat(64);
  const producer = { tool: 'fixture script', script_sha256: digest };
  const receiptPath = 'out/receipt.json', saved = join(dir, receiptPath);
  const args = ['--kind', 'mask', '--file', 'mask.png', '--painting', 'painting.png',
    '--producer', JSON.stringify({ script_sha256: digest, tool: producer.tool }), '--out', receiptPath];
  const expected = { spec: 'rig-parts-external-receipt/1', kind: 'mask',
    file: { path: '../mask.png', sha256: sha(mask) }, painting: { path: '../painting.png', sha256: sha(painting) },
    grid: { width: 2, height: 1 }, producer };
  const bytes = JSON.stringify(expected, null, 2) + '\n';
  const written = cli(...args), verified = cli('--verify', receiptPath);
  say('ORDERED_RECEIPT_AND_VERIFY', written.status === 0 && verified.status === 0 && readFileSync(saved, 'utf8') === bytes &&
    readFileSync(join(dir, 'mask.png')).equals(mask) && readFileSync(join(dir, 'painting.png')).equals(painting),
    `write exit ${written.status}, verify exit ${verified.status}; ordered fields, measured 2x1 grid, relative paths and unchanged input bytes`);
  for (const [key, author] of [
    ['CHECKPOINT', { tool: 'fixture tool', model: 'fixture model', checkpoint_sha256: digest }],
    ['GRAPH', { tool: 'fixture tool', graph_sha256: digest }],
  ] as const) {
    const path = `out/${key}.json`;
    const result = cli(...args.slice(0, 6), '--producer', JSON.stringify(author), '--out', path);
    say(key, result.status === 0 && cli('--verify', path).status === 0 &&
      readFileSync(join(dir, path), 'utf8') === JSON.stringify({ ...expected, producer: author }, null, 2) + '\n',
      `write exit ${result.status}; accepts and verifies the ${key.toLowerCase()} declaration`);
  }
  const refused = (name: string, result: ReturnType<typeof cli>, code: string, fragment = '') => {
    say(name, result.status === 1 && result.stdout.includes(code + ':') && result.stdout.includes(fragment) &&
      !existsSync(join(dir, 'out/mutant.json')) && !readdirSync(join(dir, 'out')).some(entry => entry.startsWith('.external-receipt-')),
      `exit ${result.status}; ${code}; no mutant output or staging directory`);
  };
  const replace = (flag: string, value: string) => args.map((arg, index) => args[index - 1] === flag ? value : arg);
  for (const [name, flag, value, code, fragment] of [
    ['FILL', '--kind', 'fill', 'EXTERNAL_RECEIPT_ARGUMENT', '"mask" is the accepted value'],
    ['UNREADABLE', '--file', 'missing.png', 'EXTERNAL_RECEIPT_INPUT', 'file is unreadable'],
    ['INVALID_PNG', '--painting', 'bad.png', 'EXTERNAL_RECEIPT_PNG', 'painting is not a decodable PNG'],
    ['GRID_ON_WRITE', '--file', 'short.png', 'EXTERNAL_RECEIPT_GRID', '1x1'],
    ['PIXEL_ON_WRITE', '--file', 'gray.png', 'EXTERNAL_RECEIPT_MASK_VALUES', '(128, 128, 128, 255) at pixel 1,0'],
    ['BAD_PRODUCER_JSON', '--producer', '{', 'RECEIPT_PRODUCER', ''],
    ['TWO_DIGESTS', '--producer', JSON.stringify({ ...producer, graph_sha256: digest }), 'RECEIPT_PRODUCER', ''],
  ] as const) {
    refused(name, cli(...replace(flag, value).slice(0, -1), 'out/mutant.json'), code, fragment);
  }
  refused('VERIFY_WITH_WRITE_FLAG', cli('--verify', receiptPath, '--kind', 'mask'), 'EXTERNAL_RECEIPT_ARGUMENT');
  refused('OCCUPIED_OUTPUT', cli(...args), 'EXTERNAL_RECEIPT_OUTPUT');
  for (const [name, patch, code] of [
    ['VERSION', { spec: 'rig-parts-external-receipt/2' }, 'EXTERNAL_RECEIPT_SCHEMA'],
    ['FILE_HASH', { file: { ...expected.file, sha256: sha(painting) } }, 'EXTERNAL_RECEIPT_FILE_HASH'],
    ['PAINTING_HASH', { painting: { ...expected.painting, sha256: sha(mask) } }, 'EXTERNAL_RECEIPT_PAINTING_HASH'],
    ['GRID_ON_VERIFY', { file: { path: '../short.png', sha256: sha(short) } }, 'EXTERNAL_RECEIPT_GRID'],
    ['RECORDED_GRID', { grid: { width: 1, height: 1 } }, 'EXTERNAL_RECEIPT_GRID'],
    ['PIXEL_ON_VERIFY', { file: { path: '../gray.png', sha256: sha(gray) } }, 'EXTERNAL_RECEIPT_MASK_VALUES'],
  ] as const) {
    const path = join(dir, 'out/plant.json');
    const planted = JSON.stringify({ ...expected, ...patch });
    writeFileSync(path, planted);
    refused(name, cli('--verify', 'out/plant.json'), code);
    say(`${name}_UNCHANGED`, readFileSync(path, 'utf8') === planted && readFileSync(saved, 'utf8') === bytes,
      'verify leaves planted and original receipt bytes unchanged');
  }
}
