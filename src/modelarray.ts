/** Convert a raw NumPy model array to the prepared image's numeric map grid. */
import { depthMapFail as fail, type NumericMap } from './depthmaps.ts';

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

function readHeader(header: string, at: string): { shape: number[]; itemBytes: 4 | 8 } {
  const malformed = (): never => fail('DEPTH_ARRAY_FORMAT', at,
    'malformed NumPy header; required a dictionary with exactly descr, fortran_order and shape, followed by a newline');
  if (!header.endsWith('\n')) return malformed();
  const body = header.slice(0, -1);
  let offset = 0;
  const skipSpace = (): void => {
    while (body[offset] === ' ' || body[offset] === '\t') offset++;
  };
  const take = (token: RegExp): RegExpExecArray | null => {
    skipSpace();
    token.lastIndex = offset;
    const match = token.exec(body);
    if (match !== null) offset = token.lastIndex;
    return match;
  };
  const expect = (token: RegExp): RegExpExecArray => take(token) ?? malformed();
  const quoted = (): string => {
    const match = expect(/'([^'\\\r\n]*)'|"([^"\\\r\n]*)"/y);
    return match[1] ?? match[2];
  };
  expect(/\{/y);
  let descr: string | undefined, order: string | undefined, shape: number[] | undefined;
  while (take(/\}/y) === null) {
    const key = quoted();
    expect(/:/y);
    if (key === 'descr' && descr === undefined) descr = quoted();
    else if (key === 'fortran_order' && order === undefined) order = expect(/True|False/y)[0];
    else if (key === 'shape' && shape === undefined) {
      shape = [];
      expect(/\(/y);
      if (take(/\)/y) === null) {
        do {
          shape.push(Number(expect(/-?(?:0|[1-9][0-9]*)/y)[0]));
          if (take(/,/y) !== null) continue;
          if (shape.length === 1) return malformed(); // A one-element tuple needs its comma.
          expect(/\)/y);
          break;
        } while (take(/\)/y) === null);
      }
    } else return malformed();
    if (take(/,/y) === null) {
      expect(/\}/y);
      break;
    }
  }
  skipSpace();
  if (offset !== body.length || descr === undefined || order === undefined || shape === undefined) return malformed();
  if (descr !== '<f4' && descr !== '<f8') return fail('DEPTH_ARRAY_FORMAT', at,
    `dtype ${JSON.stringify(descr)}; required little-endian float32 (<f4) or float64 (<f8)`);
  if (order !== 'False') return fail('DEPTH_ARRAY_FORMAT', at, `fortran_order=${order}; required False (C order)`);
  return { shape, itemBytes: descr === '<f4' ? 4 : 8 };
}

function readArray(bytes: Uint8Array, kind: 'depth' | 'normals', at: string) {
  if (!MAGIC.every((byte, i) => bytes[i] === byte) || bytes.length < 8) return fail('DEPTH_ARRAY_FORMAT', at,
    `found ${bytes.length} bytes without a complete NumPy magic/version prefix; required a NumPy .npy file`);
  const major = bytes[6], minor = bytes[7];
  if ((major !== 1 && major !== 2 && major !== 3) || minor !== 0) return fail('DEPTH_ARRAY_FORMAT', at,
    `NumPy version ${major}.${minor}; required 1.0, 2.0 or 3.0`);
  const prefix = major === 1 ? 10 : 12;
  if (bytes.length < prefix) return fail('DEPTH_ARRAY_FORMAT', at,
    `found ${bytes.length} bytes; required ${prefix} for the NumPy ${major}.0 prefix and header length`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const start = prefix + length;
  if (start > bytes.length) return fail('DEPTH_ARRAY_FORMAT', at,
    `header declares ${length} bytes; found ${bytes.length - prefix} bytes after the prefix`);
  let header: string;
  try {
    // The supported keys, primitive dtypes and tuple grammar are ASCII in every version.
    header = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(prefix, start));
  } catch {
    return fail('DEPTH_ARRAY_FORMAT', at, 'header contains invalid text; required the NumPy dictionary for a primitive floating-point array');
  }
  const { shape, itemBytes } = readHeader(header, at);
  const [height, width, planes] = shape;
  const channels = kind === 'depth' ? 1 : 3;
  const shapeMatches = kind === 'depth' ? shape.length === 2 || (shape.length === 3 && planes === 1) : shape.length === 3 && planes === 3;
  if (!shapeMatches || !shape.every(n => Number.isSafeInteger(n) && n > 0)) return fail('DEPTH_ARRAY_SHAPE', at,
    `shape (${shape.join(',')}) for ${kind}; required ${kind === 'depth' ? '(H,W) or (H,W,1)' : '(H,W,3)'} with positive safe integer dimensions`);
  const expected = BigInt(height) * BigInt(width) * BigInt(channels) * BigInt(itemBytes);
  const found = bytes.length - start;
  if (BigInt(found) !== expected) return fail('DEPTH_ARRAY_FORMAT', at,
    `payload has ${found} bytes; shape (${shape.join(',')}) and dtype require exactly ${expected}`);
  const value = itemBytes === 4
    ? (index: number) => view.getFloat32(start + index * itemBytes, true)
    : (index: number) => view.getFloat64(start + index * itemBytes, true);
  return { width, height, channels, value } as const;
}

function cropPadding(raw: string | undefined): [left: number, top: number, right: number, bottom: number] {
  if (raw === undefined) return [0, 0, 0, 0];
  const values = raw.split(',');
  const [left, top, right, bottom] = values.map(Number);
  if (values.length !== 4 || values.some(value => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    return fail('DEPTH_ARRAY_PADDING', 'depth-map --padding',
      `found ${JSON.stringify(raw)}; required four nonnegative safe integers LEFT,TOP,RIGHT,BOTTOM`);
  }
  return [left, top, right, bottom];
}

const magnitude = (value: bigint): bigint => value < 0n ? -value : value;

/** A finite binary64 value is an integer multiple of the smallest subnormal (2^-1074). */
function floatUnits(value: number, bits: DataView): bigint {
  bits.setFloat64(0, value);
  const high = bits.getUint32(0), low = bits.getUint32(4);
  const exponent = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  const units = exponent === 0 ? fraction : ((1n << 52n) | fraction) << BigInt(exponent - 1);
  return (high >>> 31) === 0 ? units : -units;
}

/** Divide exact units, rounding once to binary64 (nearest, ties to even). */
function meanOfUnits(sum: bigint, count: bigint): number {
  if (sum === 0n) return 0;
  const abs = magnitude(sum);
  const shift = Math.max(0, (abs / count).toString(2).length - 53);
  const divisor = count << BigInt(shift);
  const quotient = abs / divisor, twiceRemainder = (abs % divisor) * 2n;
  const roundUp = twiceRemainder > divisor || (twiceRemainder === divisor && quotient % 2n !== 0n);
  const value = Number(roundUp ? quotient + 1n : quotient) * 2 ** (shift - 1074);
  return sum < 0n ? -value : value;
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  const nx = x / scale, ny = y / scale, nz = z / scale;
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [nx / length, ny / length, nz / length];
}

export function modelArrayMap(bytes: Uint8Array, image: { width: number; height: number }, kind: string,
  padding: string | undefined, at: string): NumericMap {
  if (kind !== 'depth' && kind !== 'normals') return fail('DEPTH_ARRAY_KIND', 'depth-map --kind',
    `found ${JSON.stringify(kind)}; required depth or normals`);
  const [left, top, right, bottom] = cropPadding(padding);
  const array = readArray(bytes, kind, at);
  const retainedWidth = array.width - left - right, retainedHeight = array.height - top - bottom;
  if (retainedWidth <= 0 || retainedHeight <= 0) return fail('DEPTH_ARRAY_PADDING', at,
    `padding ${left},${top},${right},${bottom} leaves ${retainedWidth}x${retainedHeight} of raw ${array.width}x${array.height}; required a nonempty crop`);
  const { width, height } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      retainedWidth % width !== 0 || retainedHeight % height !== 0) return fail('DEPTH_ARRAY_SIZE', at,
    `retained ${retainedWidth}x${retainedHeight}, prepared PNG ${width}x${height}; required a positive integer pooling factor on each axis`);
  const stepX = retainedWidth / width, stepY = retainedHeight / height;
  const { channels, value } = array;
  const data: number[] = [];
  const single = stepX === 1 && stepY === 1;
  const count = BigInt(stepX) * BigInt(stepY), bits = new DataView(new ArrayBuffer(8));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rawLeft = left + x * stepX, rawTop = top + y * stepY;
    let sumX = 0n, sumY = 0n, sumZ = 0n;
    for (let sy = rawTop; sy < rawTop + stepY; sy++) for (let sx = rawLeft; sx < rawLeft + stepX; sx++) {
      const index = (sy * array.width + sx) * channels;
      const vx = value(index);
      if (channels === 1) {
        if (!Number.isFinite(vx)) return fail('DEPTH_ARRAY_NONFINITE', at,
          `raw pixel (${sx},${sy}) has depth ${vx}; required a finite value`);
        if (single) data.push(vx);
        else sumX += floatUnits(vx, bits);
        continue;
      }
      const vy = value(index + 1), vz = value(index + 2);
      if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz) || (vx === 0 && vy === 0 && vz === 0)) {
        return fail('DEPTH_ARRAY_NORMAL', at,
          `raw pixel (${sx},${sy}) has normal [${vx},${vy},${vz}]; required a finite nonzero XYZ vector`);
      }
      if (single) data.push(...normalize(vx, vy, vz));
      else {
        sumX += floatUnits(vx, bits);
        sumY += floatUnits(vy, bits);
        sumZ += floatUnits(vz, bits);
      }
    }
    if (single) continue;
    if (channels === 1) data.push(meanOfUnits(sumX, count));
    else {
      const scale = [sumX, sumY, sumZ].map(magnitude).reduce((a, b) => a > b ? a : b);
      if (scale === 0n) return fail('DEPTH_ARRAY_NORMAL', at,
        `output pixel (${x},${y}) has pooled normal [0,0,0]; required a nonzero pooled XYZ vector`);
      // The tile count cancels in normalization. Scale the exact sums before rounding,
      // so a subnormal residual or an overflowing sum can still give a direction.
      data.push(...normalize(meanOfUnits(sumX << 1074n, scale), meanOfUnits(sumY << 1074n, scale), meanOfUnits(sumZ << 1074n, scale)));
    }
  }
  return { spec: 'rig-parts-map/1', width, height, channels, data };
}

/** JSON accepts signed zero even though JSON.stringify emits 0 for either sign. */
export function serializeModelArrayMap(map: NumericMap): string {
  if (!map.data.some(value => Object.is(value, -0))) return JSON.stringify(map) + '\n';
  const { data, ...header } = map;
  const values = data.map(value => Object.is(value, -0) ? '-0' : String(value)).join(',');
  return `${JSON.stringify(header).slice(0, -1)},"data":[${values}]}\n`;
}
