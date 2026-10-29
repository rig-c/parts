/**
 * The contact sheet: the source painting and every layer or part, each on a
 * checkerboard, labelled, in a grid.
 *
 * It exists for the one reader who CAN see — the person checking the agent's
 * work — and for an agent that can read an image. What it prints to the
 * console is the same information as text (every tile's name, size and opaque
 * pixel count), so an agent that cannot read the image loses nothing by not
 * opening it.
 *
 * The layout is the reference implementation's contact sheet: square cells
 * (default 220 px), a 12 px checker in greys 200 and 230, each image scaled
 * with Lanczos to fit `cell - 4` wide and `cell - 30` tall — enlarging a small
 * layer as well as shrinking a large one — centred in the top of the cell, two
 * label lines at the bottom. Two deviations, both stated: the sheet is a PNG
 * (no JPEG encoder ships here), and the label is drawn in rig-c's 5x7
 * bitmap font rather than PIL's default font, so labels are upper case.
 */
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { drawText, GLYPH_H } from '@rig-c/core/tools/font5x7.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import { type LayerSet, OPAQUE_ALPHA_ABOVE, readLayers } from './layers.ts';
import { readParts } from './parts.ts';
import { alphaComposite } from './raster/composite.ts';
import { readPng } from './raster/png.ts';
import { resize } from './raster/resize.ts';
import { newRaster, type Raster } from './raster/types.ts';

export interface Tile {
  /** First label line: the name. */
  name: string;
  image: Raster;
  /** Second label line, if not the default `<w>x<h> op=<n>`. */
  caption?: string;
}

const CHECKER = 12;
const LABEL_SPACE = 30;
const SIDE_SPACE = 4;

function opaqueCount(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > OPAQUE_ALPHA_ABOVE) n++;
  return n;
}

export function defaultCaption(r: Raster): string {
  return `${r.width}x${r.height} op=${opaqueCount(r)}`;
}

function checker(cell: number): Raster {
  const r = newRaster(cell, cell);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const c = ((Math.floor(x / CHECKER) + Math.floor(y / CHECKER)) % 2) * 30 + 200;
      r.data.set([c, c, c, 255], (y * cell + x) * 4);
    }
  }
  return r;
}

/** Black text into a raster, clipped. `_` is drawn as a baseline bar: the 5x7 font has no glyph for it. */
function label(r: Raster, text: string, x0: number, y0: number): void {
  const plot = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
    r.data.set([0, 0, 0, 255], (y * r.width + x) * 4);
  };
  let x = x0;
  for (const ch of text) {
    if (ch === '_') for (let i = 0; i < 5; i++) plot(x + i, y0 + GLYPH_H - 1);
    else if (ch !== ' ') drawText(ch, x, y0, 1, plot);
    x += 6;
  }
}

export function tileImage(tile: Tile, cell: number): Raster {
  const im = tile.image;
  const sc = Math.min((cell - SIDE_SPACE) / im.width, (cell - LABEL_SPACE) / im.height);
  const w = Math.max(1, Math.trunc(im.width * sc));
  const h = Math.max(1, Math.trunc(im.height * sc));
  const scaled = resize(im, w, h, 'lanczos3');
  const bg = alphaComposite(checker(cell), scaled, Math.floor((cell - w) / 2), 2 + Math.floor((cell - LABEL_SPACE - h) / 2));
  label(bg, tile.name, 4, cell - 27);
  label(bg, tile.caption ?? defaultCaption(im), 4, cell - 27 + 12);
  return bg;
}

export function buildSheet(tiles: Tile[], cols: number, cell: number): Raster {
  const rows = Math.ceil(tiles.length / cols);
  const sheet = newRaster(cols * cell, rows * cell);
  sheet.data.fill(255);
  tiles.forEach((t, i) => {
    const img = tileImage(t, cell);
    const ox = (i % cols) * cell;
    const oy = Math.floor(i / cols) * cell;
    for (let y = 0; y < cell; y++) sheet.data.set(img.data.subarray(y * cell * 4, (y + 1) * cell * 4), ((oy + y) * sheet.width + ox) * 4);
  });
  return sheet;
}

/**
 * The tiles one `--layers` argument contributes: every layer of a See-through
 * decomposition (a wrapper directory, a `layers.json`, a `.psd`) in draw order,
 * or every part of a `parts.json` in plan order, read from `parts/<name>.png`
 * beside it. A PNG that is not there is refused by name — the reference sheet
 * skipped it silently, which is a sheet that looks complete and is not.
 */
export function tilesFrom(path: string): Tile[] {
  if (basename(path) === 'parts.json') {
    const parts = readParts(path);
    const dir = join(dirname(path), 'parts');
    const problems: Problem[] = [];
    const tiles: Tile[] = [];
    for (const p of parts.parts) {
      const png = join(dir, `${p.name}.png`);
      if (!existsSync(png)) {
        problems.push({ code: 'SHEET_PNG_PRESENT', object: `part "${p.name}"`, detail: `${png} does not exist; parts.json names it` });
        continue;
      }
      tiles.push({ name: p.name, image: readPng(png) });
    }
    refuseIfAny(problems);
    return tiles;
  }
  const set: LayerSet = readLayers(path);
  return set.layers.map((l) => ({ name: l.name, image: l.pixels }));
}
