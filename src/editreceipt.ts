/**
 * Editor receipts (issue #946): the author's record that an image this build
 * reads was edited in an image editor, held to the bytes on disk.
 *
 * What the package can know was edited is what the input itself says was made
 * outside See-through, never a guess from pixels: an author-made layer
 * (`author:<label>`, issue #256), a hidden-art layer (`<layer>:hidden`, issue
 * #359), a cut's `under` image (issue #170) and a limb segment's `cap` image
 * (issue #349). Each of those images IS an edited image by the input's own
 * declaration. A See-through layer or the painting overwritten in place by a
 * script carries no such mark, so nothing here can find it; an author may
 * still receipt it, and the receipt is then verified like any other.
 *
 * A receipt is `{file, sha256, from_sha256, editor}`:
 *
 * - `file` and `sha256` are VERIFIED: the file, relative to the config's
 *   directory, must exist and its bytes must hash to `sha256`
 *   (`ASSEMBLE_EDITOR_RECEIPT_FILE`, `ASSEMBLE_EDITOR_RECEIPT_SHA256`).
 * - `from_sha256` (the bytes the edit started from) and `editor` (the editor
 *   the author names) are DECLARATIONS. The loader holds them to presence and
 *   form, and `from_sha256` to differ from `sha256` (an edit that left the
 *   bytes unchanged is not an edit, `CONFIG_EDITOR_RECEIPT`). That a person
 *   used that editor is not something a file can show, and nothing here
 *   claims to check it.
 *
 * With `required: true` every edited image the build reads — of the base
 * runs, of each alternate set's runs, every cut `under` and limb `cap` — must
 * carry a receipt whose `sha256` is that image's file
 * (`ASSEMBLE_EDITOR_RECEIPT_MISSING`). An image is matched to its receipt by
 * content, not by path, so the two layouts a wrapper run may hold a layer in
 * (`<filename>` and `parts/<name>.png`, byte-identical by `LAYERS_PNG_UNAMBIGUOUS`)
 * resolve to one receipt. A PSD layer's file is the PSD. Absent `required`,
 * receipts that are declared are verified and nothing is demanded; absent the
 * block, no file is read and no byte of any output moves.
 *
 * Pure: reads files, hashes with `node:crypto`; no clock, no network.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Problem } from './errors.ts';
import type { LayerSet } from './layers.ts';

/** One receipt, as `config.assemble.editor_receipts.receipts[i]` holds it. */
export interface EditorReceipt {
  /** The edited image, relative to the config's directory. */
  file: string;
  /** sha256 of the edited file's bytes, 64 lowercase hex digits; verified. */
  sha256: string;
  /** sha256 of the bytes the edit started from; declared, held to form and to differ from `sha256`. */
  from_sha256: string;
  /** The editor the author names; declared. */
  editor: string;
}

/** `config.assemble.editor_receipts`. */
export interface EditorReceipts {
  /** `true`: every edited image the build reads needs a receipt. Absent or `false`: receipts are verified, none is demanded. */
  required?: boolean;
  /**
   * Issue #947, `true`: every part's pixels trace to a layer of the split or to
   * an image a receipt covers — every edited image needs a receipt, as under
   * `required`, and a shape drawn in the config through a part's pixels is
   * refused (`src/partsource.ts`). Absent or `false`: nothing more is demanded.
   */
  trace_parts?: boolean;
  receipts: EditorReceipt[];
}

/** What a sha256 field must be, as a refusal quotes it. */
export const SHA256_RULE = '64 lowercase hex digits (a sha256 of the file\'s bytes)';
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const AT = 'config.assemble.editor_receipts';

/** sha256 of a file's bytes, lowercase hex. */
export function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A receipt that verified against its file, with where it was declared. */
export interface VerifiedReceipt extends EditorReceipt {
  /** `config.assemble.editor_receipts.receipts[i]`. */
  at: string;
  /** The file, resolved against the config's directory. */
  path: string;
}

/** The receipts read for one build: those that verified, keyed by sha256, and the refusals of those that did not. */
export interface ReceiptLedger {
  required: boolean;
  /** The field that made receipts required, as a refusal names it: `required`, else `trace_parts` (issue #947). */
  by: 'required' | 'trace_parts';
  bySha: ReadonlyMap<string, VerifiedReceipt>;
  problems: Problem[];
}

/**
 * Verify every declared receipt against its file. `spec` has passed the
 * config loader (shape, hex form, `from_sha256` unlike `sha256`, unique
 * `file`). A missing file is `ASSEMBLE_EDITOR_RECEIPT_FILE`; bytes that hash
 * to another value are `ASSEMBLE_EDITOR_RECEIPT_SHA256`, naming both values.
 */
export function readEditorReceipts(spec: EditorReceipts | undefined, configPath: string): ReceiptLedger {
  const problems: Problem[] = [];
  const bySha = new Map<string, VerifiedReceipt>();
  if (spec === undefined) return { required: false, by: 'required', bySha, problems };
  const base = dirname(resolve(configPath));
  spec.receipts.forEach((r, i) => {
    const at = `${AT}.receipts[${i}]`;
    const path = resolve(base, r.file);
    const object = `${at} (file "${r.file}")`;
    if (!existsSync(path) || !statSync(path).isFile()) {
      problems.push({ code: 'ASSEMBLE_EDITOR_RECEIPT_FILE', object, detail: `names ${path}, which is no such file; the edited image, its path relative to the config's directory, is required` });
      return;
    }
    const found = fileSha256(path);
    if (found !== r.sha256) {
      problems.push({ code: 'ASSEMBLE_EDITOR_RECEIPT_SHA256', object, detail: `the file's bytes hash to sha256 ${found}; the receipt's sha256 ${r.sha256} is required — the file changed after its receipt was written, or the receipt names another file` });
      return;
    }
    if (!bySha.has(found)) bySha.set(found, { ...r, at, path });
  });
  const by = spec.required === true || spec.trace_parts !== true ? 'required' : 'trace_parts';
  return { required: spec.required === true || spec.trace_parts === true, by, bySha, problems };
}

/** An image the input itself says was made or edited outside See-through. */
export interface EditedImage {
  /** How the input names it: `full:author:hand`, `config.assemble.cuts[0].under (part "x")`. */
  object: string;
  /** The file its pixels are read from. */
  path: string;
}

/**
 * The edited images of a pair of runs: every author-made layer and every
 * hidden-art layer, named `<run>:<layer>` as `parts.json`'s `from` names a
 * layer, after `label`. With one run (`single`) the head run is the full run
 * and is listed once. A PSD layer has no file of its own; its file is the PSD.
 */
export function editedRunImages(runs: { full: LayerSet; head: LayerSet; single: boolean }, label = ''): EditedImage[] {
  const out: EditedImage[] = [];
  for (const run of runs.single ? (['full'] as const) : (['full', 'head'] as const)) {
    const set = runs[run];
    for (const l of set.layers) if (l.tag.group === 'author') out.push({ object: `${label}${run}:${l.name}`, path: resolve(l.file ?? set.source) });
    for (const h of set.hidden) out.push({ object: `${label}${run}:${h.name}`, path: resolve(h.file ?? set.source) });
  }
  return out;
}

/** The images a config names by path that the author painted: every cut's `under` and every limb segment's `cap`. */
export function editedConfigImages(configPath: string, cuts: ReadonlyArray<{ into: string; under?: string }>, limbs: Readonly<Record<string, { segments: ReadonlyArray<{ part: string; cap?: string }> }>> | undefined, cutsAt = 'config.assemble.cuts'): EditedImage[] {
  const base = dirname(resolve(configPath));
  const out: EditedImage[] = [];
  cuts.forEach((q, i) => {
    if (q.under !== undefined) out.push({ object: `${cutsAt}[${i}].under (part "${q.into}")`, path: resolve(base, q.under) });
  });
  for (const [l, limb] of Object.entries(limbs ?? {})) {
    limb.segments.forEach((sg, k) => {
      if (sg.cap !== undefined) out.push({ object: `config.limbs.${l}.segments[${k}].cap (part "${sg.part}")`, path: resolve(base, sg.cap) });
    });
  }
  return out;
}

/**
 * Under `required: true` (or `trace_parts: true`, issue #947), every edited image must have a receipt whose
 * `sha256` is its file's bytes: `ASSEMBLE_EDITOR_RECEIPT_MISSING` names the
 * image, its file and the sha256 found. A file that is not on disk is left to
 * the reader that names it (`ASSEMBLE_UNDER_PRESENT`, `ASSEMBLE_LIMB_CAP_PRESENT`).
 * Absent `required`, nothing is demanded and this returns no problem.
 */
export function missingReceipts(ledger: ReceiptLedger, images: readonly EditedImage[]): Problem[] {
  if (!ledger.required) return [];
  const problems: Problem[] = [];
  for (const image of images) {
    if (!existsSync(image.path) || !statSync(image.path).isFile()) continue;
    const found = fileSha256(image.path);
    if (ledger.bySha.has(found)) continue;
    problems.push({
      code: 'ASSEMBLE_EDITOR_RECEIPT_MISSING',
      object: image.object,
      detail: `${image.path} (sha256 ${found}) carries no editor receipt; ${AT}.${ledger.by} is true, so a receipt {file, sha256, from_sha256, editor} whose sha256 is this file's is required — edit the image in an image editor and record it, never generate or patch it in code`,
    });
  }
  return problems;
}

/** The verified receipt for a file's current bytes, or null: the lookup a later gate (issue #947) traces a part's pixels through. */
export function receiptFor(ledger: ReceiptLedger, path: string): VerifiedReceipt | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return ledger.bySha.get(fileSha256(path)) ?? null;
}
