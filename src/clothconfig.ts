/**
 * `propose --cloth … --write-config <out.json>` (issue #537): the `--cloth` config's own text with the sections the
 * recipe drafts spliced in, the way `mesh-draft` writes its config ({@link splicedEdits}). The producer is the one
 * writer of its own config; a reviewer that edits a recipe rebuilds through it.
 *
 * What is spliced is measured, not listed: the same parts drafted twice, once with the recipe and once without it
 * (`cloth: null`), and each config section of the proposal ({@link PROPOSAL_CONFIG_SECTIONS}) whose value differs
 * between the two is drafted ({@link clothConfigEdits}). An object section (`meshes`, `regions`, `motion`) is
 * spliced entry by entry — `meshes.<part>` and `regions.<part>` for each part the recipe moved, `motion.tracks` and
 * not the author's `animations_from` — and so, from issue #552, is an array section (`bones`, `constraints`,
 * `motion.tracks`): its entries are named ({@link ARRAY_SECTIONS}), the entries the recipe produced or changed are
 * replaced in place or inserted, the entries it replaced are removed, and every other entry of the input — one the
 * author added by hand among them — keeps its bytes and its place. A hand edit to an entry the recipe re-drafts or
 * removes is refused by name, `PROPOSE_WRITE_CONFIG_CONFLICT`, rather than dropped. A section the recipe does not
 * move keeps the input's bytes.
 */

import type { CharacterConfig } from './config.ts';
import { PartsError, type Problem } from './errors.ts';
import { chainFigures } from './instruments.ts';
import { type ConfigEdit, splicedEdits } from './meshdraft.ts';
import { idleMotion } from './motion.ts';
import { type ChainLeftBehindFinding, PROPOSAL_CONFIG_SECTIONS, type Proposal } from './propose.ts';

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Key-order-blind JSON text: two entries are the same value when this is the same string. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isPlain(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** One edit `--write-config` makes, with the words the write line prints for it. */
export interface ClothEdit extends ConfigEdit {
  label: string;
  /** Issue #571: the input's entry was the previous recipe's draft (`--from`), and only that made it the recipe's. */
  previous?: true;
  /**
   * Issue #630: the entry is written back to the draft without the recipe (`--from`): the previous recipe drafted it
   * and the recipe now does not — a tag whose recipe was dropped while another was kept.
   */
  plain?: true;
}

/**
 * An array section spliced entry by entry (issue #552), and what names an entry in it: a bone by `name` (a single
 * bone) or `chain` (a chain), one namespace, as a mesh segment resolves either; a constraint by `name`; a track by
 * `chain`, or by `bone` and `prop` (the proposer writes two tracks on one bone, `translatey` and `scalex`). An entry
 * with no such name has no identity: it is never the recipe's, so it is kept.
 */
export const ARRAY_SECTIONS: ReadonlyArray<{ path: readonly string[]; identity: (e: unknown) => string | null }> = [
  { path: ['bones'], identity: (e) => (isPlain(e) ? (typeof e.name === 'string' ? e.name : typeof e.chain === 'string' ? e.chain : null) : null) },
  { path: ['constraints'], identity: (e) => (isPlain(e) && typeof e.name === 'string' ? e.name : null) },
  {
    path: ['motion', 'tracks'],
    identity: (e) => (isPlain(e) ? (typeof e.chain === 'string' ? e.chain : typeof e.bone === 'string' && typeof e.prop === 'string' ? `${e.bone} ${e.prop}` : null) : null),
  },
];

function valueAt(o: unknown, path: readonly string[]): unknown {
  let v = o;
  for (const k of path) v = isPlain(v) ? v[k] : undefined;
  return v;
}

/** Each entry of a drafted array by its name; the proposer names every entry once, and anything else is this module's error. */
function byName(arr: readonly unknown[], identity: (e: unknown) => string | null, which: string, section: string): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const e of arr) {
    const k = identity(e);
    if (k === null) throw new Error(`clothConfigEdits: the ${which} ${section} holds an entry with no name: ${JSON.stringify(e)}`);
    if (m.has(k)) throw new Error(`clothConfigEdits: the ${which} ${section} names "${k}" twice`);
    m.set(k, e);
  }
  return m;
}

/** The first field, in the author's order, where the author's entry differs from `ref`; null when the two are not both objects. */
function firstField(author: unknown, ref: unknown): string | null {
  if (!isPlain(author) || !isPlain(ref)) return null;
  for (const k of [...Object.keys(author), ...Object.keys(ref).filter((k) => !(k in author))]) if (canon(author[k]) !== canon(ref[k])) return k;
  return null;
}

function shown(v: unknown): string {
  const t = JSON.stringify(v);
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}

/**
 * The edits on one array section, entry by entry (issue #552). With `I` the input's entry of a name, `P` the plain
 * draft's and `D` the recipe's (equality is of the value, key order aside):
 * - owned (D present, and P absent or different): `I` absent is inserted after the input's entry that precedes it in
 *   the drafted array (the nearest earlier drafted entry the array holds, one inserted before it included), else at
 *   the end; `I` equal to `P` is replaced in place; `I` equal to `D` is left as it is;
 * - removed (P present, D absent — the recipe replaced a plain chain with its trees): `I` equal to `P` is removed;
 * - every other input entry is kept, bytes and order;
 * - an owned or removed `I` that is none of those — changed by hand — is a conflict, as is a name the input states twice.
 *
 * With `V`, the previous recipe's draft (`previous`, issue #571 — `--from`; null without it): `I` equal to `V` is the
 * recipe's as `I` equal to `P` is — an owned name is replaced, and a name in `V` and not in `D` is removed — and a
 * conflict is an `I` equal to none of `D`, `P` and `V`, its first differing field read against `V` where `V` holds the
 * name. Without `previous` every rule, and every word of the refusal, is the one above.
 *
 * Issue #630: with `V`, a name `D` holds equal to `P` that `V` lacks or holds differently — an entry the previous
 * recipe drafted (or replaced) and this one leaves to the draft without the recipe, as for a tag whose recipe was
 * dropped while another was kept — is owned too: inserted where the input lacks it, replaced where the input equals
 * `V`, and a conflict where it equals neither. Such an edit carries `plain`. `keepDropped` is the selftest's mutant
 * only (the writer before #630, which never owned it); no flag or environment reaches it.
 */
function entryEdits(
  path: readonly string[],
  identity: (e: unknown) => string | null,
  drafted: readonly unknown[],
  plain: readonly unknown[],
  input: readonly unknown[],
  conflicts: Problem[],
  previous: readonly unknown[] | null,
  keepDropped = false,
): ClothEdit[] {
  const section = path.join('.');
  const D = byName(drafted, identity, 'drafted', section);
  const P = byName(plain, identity, 'plain', section);
  const V = previous === null ? null : byName(previous, identity, 'previous', section);
  const keys = input.map(identity);
  const where = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (k !== null) where.set(k, [...(where.get(k) ?? []), i]);
  });
  const recipes = new Set([...D.keys()].filter((k) => !P.has(k) || canon(P.get(k)) !== canon(D.get(k))));
  // Issue #630: a plain entry the previous recipe drafted differently or took away, which this recipe leaves plain.
  const returned = new Set(V === null || keepDropped ? [] : [...D.keys()].filter((k) => !recipes.has(k) && (!V.has(k) || canon(V.get(k)) !== canon(D.get(k)))));
  const owned = [...D.keys()].filter((k) => recipes.has(k) || returned.has(k));
  const removed = [...P.keys(), ...(V === null ? [] : [...V.keys()].filter((k) => !P.has(k)))].filter((k) => !D.has(k));
  const replace: string[] = [];
  const remove: string[] = [];
  const vouched = new Set<string>();
  const conflict = (k: string, i: number, drafts: boolean): void => {
    const author = input[i];
    const prev = V !== null && V.has(k) ? V.get(k) : undefined;
    const field = firstField(author, prev !== undefined ? prev : P.has(k) ? P.get(k) : D.get(k));
    const fieldOf = (e: unknown, f: string): string => (isPlain(e) && e[f] !== undefined ? `${f} ${shown(e[f])}` : `no ${f}`);
    const held = field === null ? `the entry ${shown(author)}` : fieldOf(author, field);
    const draft = D.get(k);
    const draftSays = !drafts ? 'the draft removes the entry (the recipe drafts that part afresh)' : field === null ? `the draft writes ${shown(draft)}` : `the draft writes ${fieldOf(draft, field)}`;
    // Issue #571: with --from, the entry equals none of the three drafts; the field is read against the previous recipe's, the draft a person edited from.
    const says =
      V === null
        ? `it holds ${held} where ${draftSays}`
        : `it equals neither the draft, the draft without the recipe, nor the previous recipe's draft: it holds ${held} where ${prev === undefined ? 'the previous recipe\'s draft has no such entry' : `the previous recipe's draft writes ${field === null ? shown(prev) : fieldOf(prev, field)}`} and ${draftSays}`;
    conflicts.push({
      code: 'PROPOSE_WRITE_CONFIG_CONFLICT',
      object: `config.${section}[${i}] "${k}"`,
      detail: `${section} entry "${k}" is the recipe's, and it was changed by hand: ${says}, so the write would drop the hand edit; take the draft by removing the hand edit (or the entry), or leave the recipe out for that part (its config.cloth block)`,
    });
  };
  for (const k of [...owned, ...removed]) {
    const at = where.get(k) ?? [];
    if (at.length > 1) {
      conflicts.push({
        code: 'PROPOSE_WRITE_CONFIG_CONFLICT',
        object: `config.${section}[${at[1]}] "${k}"`,
        detail: `${section} names "${k}" ${at.length} times (entries ${at.join(', ')}), and the recipe drafts that name, so the write cannot tell which entry is the recipe's; state it once`,
      });
      continue;
    }
    if (at.length === 0) continue;
    const I = canon(input[at[0]]);
    const isPrevious = V !== null && V.has(k) && I === canon(V.get(k));
    if (D.has(k)) {
      if (I === canon(D.get(k))) continue;
      if (P.has(k) && I === canon(P.get(k))) replace.push(k);
      else if (isPrevious) {
        replace.push(k);
        vouched.add(k);
      } else conflict(k, at[0], true);
    } else if (P.has(k) && I === canon(P.get(k))) remove.push(k);
    else if (isPrevious) {
      remove.push(k);
      vouched.add(k);
    } else conflict(k, at[0], false);
  }
  const mark = (k: string): { previous?: true; plain?: true } => ({ ...(vouched.has(k) ? { previous: true as const } : {}), ...(returned.has(k) ? { plain: true as const } : {}) });
  const edits: ClothEdit[] = [];
  const work = [...keys];
  for (const k of replace) edits.push({ path: [...path, work.indexOf(k)], value: D.get(k), label: `${section}["${k}"] replaced`, ...mark(k) });
  for (const k of remove) {
    const i = work.indexOf(k);
    edits.push({ path: [...path, i], value: undefined, label: `${section}["${k}"] removed`, ...mark(k) });
    work.splice(i, 1);
  }
  const order = [...D.keys()];
  for (const k of owned) {
    if (work.includes(k)) continue;
    let pos = work.length;
    for (let j = order.indexOf(k) - 1; j >= 0; j--) {
      const before = work.indexOf(order[j]);
      if (before >= 0) {
        pos = before + 1;
        break;
      }
    }
    edits.push({ path: [...path, pos], value: D.get(k), insert: true, label: `${section}["${k}"] inserted`, ...mark(k) });
    work.splice(pos, 0, k);
  }
  return edits;
}

/**
 * The edits that turn `input` (the `--cloth` config, parsed) into one holding what the recipe drafts, measured as the
 * difference between the draft with the recipe (`drafted`) and without it (`plain`): for each config section whose
 * value differs, an object section entry by entry (an entry the recipe removed, such as a part it took from `regions`
 * into `meshes`, is removed), an array section of {@link ARRAY_SECTIONS} entry by entry ({@link entryEdits}) where
 * the input holds it as an array, and any other section, or one the input lacks, whole. Every conflict is collected and
 * refused in one throw, `PROPOSE_WRITE_CONFIG_CONFLICT`, before anything is written.
 *
 * `previous` (issue #571, `propose --write-config --from <config>`) is the same parts drafted a third time, with the
 * recipe of the config the recipe is changed from: an array entry equal to its draft is the recipe's ({@link entryEdits}),
 * and an array section the two drafts agree at is read entry by entry where the previous draft differs from them. An
 * object entry (`meshes.<part>`, `regions.<part>`) the recipe drafts is replaced whole already, so `previous` changes
 * nothing there. Null — no `--from` — is the writer before #571, rule for rule and byte for byte.
 *
 * Issue #630: where the two drafts agree and the previous draft differs — what the previous recipe drafted and this one
 * leaves to the draft without the recipe, a tag whose recipe was dropped while another was kept — the entry goes back
 * to the plain draft: in an array section by {@link entryEdits}' rule, and at any other entry (`meshes.<part>`,
 * `regions.<part>`, a section the input holds whole) when the input equals the previous draft there or lacks the entry
 * in an object it holds; an input equal to neither the draft nor the previous draft there is a hand edit, refused by
 * name. Each such edit that writes the plain draft's value carries `plain` (a removal does not, as an array name the
 * previous recipe drafted and the plain draft lacks is removed without it). A section the input lacks is left to the
 * input, as before.
 *
 * `whole` is the selftest's mutant only (issue #552): `bones`, `constraints` and `motion.tracks` replaced whole, as
 * the #537 writer did; `keepDropped` is the selftest's mutant only (issue #630): the writer before it, which leaves a
 * dropped recipe's entries as the previous draft wrote them. No flag or environment reaches either.
 */
export function clothConfigEdits(drafted: Proposal, plain: Proposal, input: unknown, whole = false, previous: Proposal | null = null, keepDropped = false): ClothEdit[] {
  const edits: ClothEdit[] = [];
  const conflicts: Problem[] = [];
  const d = JSON.parse(JSON.stringify(drafted)) as Record<string, unknown>;
  const p = JSON.parse(JSON.stringify(plain)) as Record<string, unknown>;
  const v = previous === null || whole ? null : (JSON.parse(JSON.stringify(previous)) as Record<string, unknown>);
  const arrayOf = (path: readonly string[]): (typeof ARRAY_SECTIONS)[number] | undefined => (whole ? undefined : ARRAY_SECTIONS.find((x) => x.path.join('.') === path.join('.')));
  const prevAt = (path: readonly string[]): unknown[] | null => {
    if (v === null) return null;
    const c = valueAt(v, path);
    return Array.isArray(c) ? c : [];
  };
  const one = (path: readonly string[], a: unknown, b: unknown): void => {
    const s = arrayOf(path);
    const mine = valueAt(input, path);
    if (s !== undefined && Array.isArray(b) && (a === undefined || Array.isArray(a)) && Array.isArray(mine)) edits.push(...entryEdits(path, s.identity, b, Array.isArray(a) ? a : [], mine, conflicts, prevAt(path), keepDropped));
    else edits.push({ path, value: b, label: path.join('.') });
  };
  // Issue #571: an array section the two drafts agree at, where the previous draft differs — its entries the previous recipe drafted and this one does not.
  // Issue #630: and any other entry there, which goes back to the draft (the plain draft's value, the two agreeing).
  const prevOnly = (path: readonly string[], b: unknown): void => {
    if (v === null) return;
    const s = arrayOf(path);
    const mine = valueAt(input, path);
    const c = valueAt(v, path);
    if (canon(c) === canon(b)) return;
    if (s !== undefined && (Array.isArray(b) || b === undefined) && Array.isArray(mine)) {
      const drafts = Array.isArray(b) ? b : [];
      edits.push(...entryEdits(path, s.identity, drafts, drafts, mine, conflicts, prevAt(path), keepDropped));
      return;
    }
    if (keepDropped || s !== undefined) return;
    // The entry's own object must be the input's: a section the input lacks is the input's to lack, as before #630.
    const holder = path.length === 1 ? input : valueAt(input, path.slice(0, -1));
    if (!isPlain(holder) || (path.length === 1 && mine === undefined)) return;
    const where = `config.${path.join('.')}`;
    if (canon(mine) === canon(b)) return;
    if (mine === undefined || canon(mine) === canon(c)) {
      edits.push({ path, value: b, label: `${path.join('.')} ${b === undefined ? 'removed' : mine === undefined ? 'inserted' : 'replaced'}`, ...(b !== undefined ? { plain: true as const } : {}), ...(mine !== undefined ? { previous: true as const } : {}) });
      return;
    }
    const field = firstField(mine, c);
    const at = (e: unknown, f: string): string => (isPlain(e) && e[f] !== undefined ? `${f} ${shown(e[f])}` : `no ${f}`);
    conflicts.push({
      code: 'PROPOSE_WRITE_CONFIG_CONFLICT',
      object: where,
      detail: `${path.join('.')} is the previous recipe's, the recipe now leaves it to the draft without the recipe, and it was changed by hand: it equals neither the draft nor the previous recipe's draft: it holds ${field === null ? shown(mine) : at(mine, field)} where the previous recipe's draft writes ${c === undefined ? 'no such entry' : field === null ? shown(c) : at(c, field)} and the draft writes ${b === undefined ? 'no such entry' : field === null ? shown(b) : at(b, field)}, so the write would drop the hand edit; take the draft by removing the hand edit (or the entry), or keep the recipe for that part (its config.cloth block)`,
    });
  };
  const prevKeys = (section: string, have: readonly string[]): string[] => {
    const pv = v === null ? undefined : v[section];
    return isPlain(pv) ? Object.keys(pv).filter((k) => !have.includes(k)) : [];
  };
  for (const section of PROPOSAL_CONFIG_SECTIONS) {
    const a = p[section];
    const b = d[section];
    if (JSON.stringify(a) === JSON.stringify(b)) {
      if (isPlain(b)) for (const k of [...Object.keys(b), ...prevKeys(section, Object.keys(b))]) prevOnly([section, k], b[k]);
      else if (b === undefined && isPlain(v === null ? undefined : v[section])) for (const k of prevKeys(section, [])) prevOnly([section, k], undefined);
      else prevOnly([section], b);
      continue;
    }
    if (isPlain(a) && isPlain(b)) {
      const keys = [...Object.keys(b), ...Object.keys(a).filter((k) => !(k in b))];
      for (const k of [...keys, ...prevKeys(section, keys)]) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) one([section, k], a[k], b[k]);
        else prevOnly([section, k], b[k]);
      }
    } else one([section], a, b);
  }
  if (conflicts.length > 0) throw new PartsError(conflicts);
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

/** Issue #571: how many edits the previous recipe's draft vouched for — an entry that equalled it, and only it. */
export function previousCount(edits: readonly ClothEdit[]): number {
  return edits.filter((e) => e.previous === true).length;
}

/** Issue #630: how many edits wrote an entry back to the draft without the recipe — a dropped recipe's entries. */
export function plainCount(edits: readonly ClothEdit[]): number {
  return edits.filter((e) => e.plain === true).length;
}

/** What each edit names, in order: what the write line prints. */
export function editPaths(edits: readonly ClothEdit[]): string[] {
  return edits.map((e) => e.label);
}

/** One config's keyed chains as `CHAIN_LAG` reads them: the rig's bone tree from `bones`, and the idle `idleMotion` writes. */
function keyedChains(cfg: CharacterConfig): { figures: ReturnType<typeof chainFigures>; field: Map<string, string> } {
  const bones: Array<{ name: string; parent: string | null }> = [];
  const links = new Map<string, string[]>();
  for (const e of cfg.bones) {
    if ('chain' in e) {
      const names = e.points.map((_, k) => `${e.chain}${k}`);
      names.forEach((n, k) => bones.push({ name: n, parent: k === 0 ? e.parent : names[k - 1] }));
      links.set(e.chain, names);
    } else bones.push({ name: e.name, parent: e.parent });
  }
  // The config field that keys each bone's rotation, as the author would edit it.
  const field = new Map<string, string>();
  for (const t of cfg.motion.tracks) {
    if ('chain' in t) (links.get(t.chain) ?? []).forEach((n, i) => field.set(n, `motion.tracks chain "${t.chain}" amps[${i}]`));
    else if (t.prop === 'rotate') field.set(t.bone, `motion.tracks bone "${t.bone}" prop "rotate" amp`);
  }
  // check reads motion.json as written; the round trip through JSON is that file's shape.
  const motion = JSON.parse(JSON.stringify(idleMotion(cfg, links))) as Record<string, unknown>;
  return { figures: chainFigures({ bones }, motion), field };
}

/** The config field keying `bone`; every rotate-keyed bone of the idle is keyed by a config track, so a miss is this module's error. */
function fieldOf(field: ReadonlyMap<string, string>, bone: string): string {
  const f = field.get(bone);
  if (f === undefined) throw new Error(`chainsLeftBehind: no config track keys the rotation of "${bone}"`);
  return f;
}

/** Python's `round(x, 3)`, as check's `CHAIN_LAG` rounds both amplitudes before it compares them (`src/check.ts`, `chainLine`). */
function round3(x: number): number {
  return Number(x.toFixed(3));
}

/**
 * Issue #572: the links `CHAIN_LAG` would refuse after the recipe that it did not read before. `before` is the config
 * the recipe drafts into (the plain draft, or the `--cloth` config `--write-config` splices) and `after` the one it
 * hands back (the draft with the recipe, or the config written), each read with `CHAIN_LAG`'s own reader,
 * `chainFigures` over the bone tree and the idle the rig stage writes. A pair `above > bone` adjacent in a run of
 * `after` and in no run of `before` is a run the recipe made — it took the idle keys off `above`'s other keyed
 * children — and where `bone`'s amplitude falls below `above`'s (both to three places, as check compares them) it is a
 * finding. A pair `before` already ran is check's to name, as it was. Nothing is changed: the amplitude is the
 * author's. Rotate tracks under one control (`<bone>_ctl`) keep the same tree, so the config's bones read as the rig's.
 */
export function chainsLeftBehind(before: CharacterConfig, after: CharacterConfig): ChainLeftBehindFinding[] {
  const b = keyedChains(before).figures;
  const a = keyedChains(after);
  const ran = new Set<string>();
  for (const c of b.chains) for (let i = 1; i < c.length; i++) ran.add(`${c[i - 1].bone}>${c[i].bone}`);
  const keyedUnder = (f: ReturnType<typeof chainFigures>, p: string): string[] => [...f.edges.filter((e) => e.parent === p).map((e) => e.child), ...f.otherPeriod.filter((e) => e.parent === p).map((e) => e.child)];
  const out: ChainLeftBehindFinding[] = [];
  for (const c of a.figures.chains) {
    for (let i = 1; i < c.length; i++) {
      const above = c[i - 1].bone;
      const bone = c[i].bone;
      const hi = round3(c[i - 1].reading.amp);
      const lo = round3(c[i].reading.amp);
      if (!(lo < hi) || ran.has(`${above}>${bone}`)) continue;
      const now = new Set(keyedUnder(a.figures, above));
      out.push({
        kind: 'chain-left-behind',
        bone,
        above,
        chain: c.map((l) => l.bone),
        amp: lo,
        aboveAmp: hi,
        siblings: keyedUnder(b, above).filter((s) => !now.has(s)),
        field: fieldOf(a.field, bone),
      });
    }
  }
  return out;
}
