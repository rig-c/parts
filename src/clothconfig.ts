/**
 * `propose --cloth … --write-config <out.json>` (issue #537): the `--cloth` config's own text with the sections the
 * recipe drafts spliced in, the way `mesh-draft` writes its config ({@link splicedEdits}). The producer is the one
 * writer of its own config; a reviewer that edits a recipe rebuilds through it.
 *
 * What is spliced is measured, not listed: the same parts drafted twice, once with the recipe and once without it
 * (`cloth: null`), and each config section of the proposal ({@link PROPOSAL_CONFIG_SECTIONS}) whose value differs
 * between the two is drafted ({@link clothConfigEdits}). An object section (`meshes`, `regions`, `motion`) is
 * spliced entry by entry — `meshes.<part>` and `regions.<part>` for each part the recipe moved, `motion.tracks` and
 * not the author's `animations_from` — and an array section (`bones`, `constraints`) whole: the drafted array
 * replaces the input's, so a bone the author added by hand does not survive a write. A section the recipe does not
 * move keeps the input's bytes.
 */

import { PartsError } from './errors.ts';
import { type ConfigEdit, splicedEdits } from './meshdraft.ts';
import { PROPOSAL_CONFIG_SECTIONS, type Proposal } from './propose.ts';

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The edits that turn a config holding the draft without the recipe (`plain`) into one holding the draft with it
 * (`drafted`): for each config section whose value differs, an object section entry by entry (an entry the recipe
 * removed, such as a part it took from `regions` into `meshes`, is removed) and any other section whole.
 */
export function clothConfigEdits(drafted: Proposal, plain: Proposal): ConfigEdit[] {
  const edits: ConfigEdit[] = [];
  const d = drafted as unknown as Record<string, unknown>;
  const p = plain as unknown as Record<string, unknown>;
  for (const section of PROPOSAL_CONFIG_SECTIONS) {
    const a = p[section];
    const b = d[section];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (isPlain(a) && isPlain(b)) {
      for (const k of [...Object.keys(b), ...Object.keys(a).filter((k) => !(k in b))]) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) edits.push({ path: [section, k], value: b[k] });
      }
    } else edits.push({ path: [section], value: b });
  }
  return edits;
}

/**
 * The config `--write-config` writes: `text` (the `--cloth` config at `where`) with {@link clothConfigEdits} spliced
 * in. Refused, `PROPOSE_WRITE_CONFIG_SPLICE`, when the spliced text does not parse to the input with those edits
 * made — the text states a key twice, so the edit lands on one and the parse keeps the other.
 */
export function writtenClothConfig(where: string, text: string, edits: readonly ConfigEdit[]): string {
  const r = splicedEdits(text, edits);
  if (r.moved !== null) {
    throw new PartsError([
      {
        code: 'PROPOSE_WRITE_CONFIG_SPLICE',
        object: where,
        detail: `the drafted sections spliced into this text do not parse to the config with them set: ${r.moved} moved (the text states a key twice, so the splice lands on the first and the parse keeps the last); state each key once`,
      },
    ]);
  }
  return r.text;
}

/** The paths the edits name, dotted, in order: what the write line prints. */
export function editPaths(edits: readonly ConfigEdit[]): string[] {
  return edits.map((e) => e.path.join('.'));
}
