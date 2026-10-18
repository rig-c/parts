/**
 * See-through's layer vocabulary, as the tags a layer arrives named by.
 *
 * ⭐ These are the **v3** tags — the vocabulary `pipeline.unet.get_tag_version()`
 * reports on the `seethroughv0.0.2_layerdiff3d` weights, read out of the
 * upstream code: 13 body tags and 11 head tags, 24 in all. The older v2
 * vocabulary has 19 tags and a single `hair` tag; it is not what the published
 * v0.0.2 weights emit, and a layer named by it is refused as unknown rather
 * than mapped, because a mapping would be a guess about which v3 tag it meant.
 *
 * Six tags are split left/right by upstream (`_tag_lr_split`, which needs the
 * tag's mask to be two separate blobs): `handwear`, `eyewhite`, `irides`,
 * `eyelash`, `eyebrow`, `ears`. A split layer is named `<tag>-r` / `<tag>-l`.
 * **[observed]** on wrapper output: `-r` is the half at the smaller image x —
 * the character's right as they face the viewer — and the wrapper emits both
 * halves even when one is a few pixels (a 6x6 `handwear-l` beside a 275x352
 * `handwear-r`), so "both halves present" says nothing about the split having
 * found two real blobs.
 *
 * `head` is in the v3 list but is not emitted as a layer: upstream's README
 * says the pipeline "stratifies the character into up to 23 semantic layers"
 * (24 tags less `head`, whose pass arrives as its parts), and **[observed]**
 * no wrapper output read so far carries one. It stays in the vocabulary
 * because it is upstream's word.
 *
 * Nothing downstream classifies a part by its NAME. The role of a part — what
 * a proposer may do with it — is read from the tag it came from, which is why
 * `parts.json` records `from` for every part.
 *
 * ⭐ **An author-made layer** (issue #256) is a layer the author split or
 * painted by hand outside the tool — a hand laid over a hip taken out of
 * `handwear`, a loop of hair over a shoulder taken out of `back hair` — and
 * added to a run. It is named `author:<label>` ({@link AUTHOR_PREFIX}), the
 * label the author's own. It is not a See-through tag and carries no role:
 * {@link readTag} never reads it, so no rule that reads roles from tags ever
 * sees it, and every reader that admits a layer reads it through
 * {@link readLayerTag}, which says `group: "author"`. Why a prefix and this
 * one: a single reserved name would let a run hold one such layer (a tag
 * names one layer, `LAYERS_NAME_UNIQUE`, and one layer makes one part); no
 * v3 tag holds a colon, so the prefix cannot be read as a See-through tag or
 * as one of its `-r`/`-l` halves; and `<origin>:<name>` is already how
 * `parts.json` says "not a See-through layer" for a patch (`painting:<name>`).
 * Every reader of a part's `from` splits at the first colon, so
 * `full:author:hand` is the full run's layer `author:hand`.
 */

export const BODY_TAGS = [
  'front hair',
  'back hair',
  'head',
  'neck',
  'neckwear',
  'topwear',
  'handwear',
  'bottomwear',
  'legwear',
  'footwear',
  'tail',
  'wings',
  'objects',
] as const;

export const HEAD_TAGS = [
  'headwear',
  'face',
  'irides',
  'eyebrow',
  'eyewhite',
  'eyelash',
  'eyewear',
  'ears',
  'earwear',
  'nose',
  'mouth',
] as const;

/** The tags `splitMergedArmRuns` (issue #490) splits out of a merged `handwear-r` / `handwear-l` layer: `<tag>-r` / `<tag>-l`. */
export const ARM_MERGED_SPLIT_TAGS = ['hand', 'drape'] as const;
export type ArmMergedSplitTag = (typeof ARM_MERGED_SPLIT_TAGS)[number];

export type BaseTag = (typeof BODY_TAGS)[number] | (typeof HEAD_TAGS)[number] | ArmMergedSplitTag;

/** The tags upstream splits into `-r` / `-l` halves. */
export const SPLIT_TAGS = ['handwear', 'eyewhite', 'irides', 'eyelash', 'eyebrow', 'ears'] as const;

export type SplitTag = (typeof SPLIT_TAGS)[number];
export type Side = 'r' | 'l';

/** Every v3 tag, in the order upstream lists them. */
export const V3_TAGS: readonly BaseTag[] = [...BODY_TAGS, ...HEAD_TAGS];

export interface TagReading {
  /** The name as the layer carries it: `eyebrow-l`, `front hair`. */
  name: string;
  base: BaseTag;
  /** `null` for an unsplit tag or an unsplit form of a split tag. */
  side: Side | null;
  group: 'body' | 'head';
}

/**
 * Read a layer name as a v3 tag, or `null` when it is not one.
 *
 * Accepted: any of the 24 base tags, `<tag>-r` / `<tag>-l` for the six
 * split tags, and `<tag>-r` / `<tag>-l` for the merged-arm split tags
 * (`hand-r`, `hand-l`, `drape-r`, `drape-l`, issue #490). A suffix on a tag
 * upstream never splits (`topwear-l`) is not a tag — upstream cannot have
 * produced it, so accepting it would be accepting a layer somebody renamed.
 */
export function readTag(name: string): TagReading | null {
  const split = /^(.+)-([rl])$/.exec(name);
  if (split !== null && (SPLIT_TAGS as readonly string[]).includes(split[1])) {
    const base = split[1] as SplitTag;
    return { name, base, side: split[2] as Side, group: groupOf(base) };
  }
  if (split !== null && (ARM_MERGED_SPLIT_TAGS as readonly string[]).includes(split[1])) {
    const base = split[1] as ArmMergedSplitTag;
    return { name, base, side: split[2] as Side, group: 'body' };
  }
  if ((V3_TAGS as readonly string[]).includes(name)) {
    const base = name as BaseTag;
    return { name, base, side: null, group: groupOf(base) };
  }
  return null;
}

function groupOf(tag: BaseTag): 'body' | 'head' {
  return (HEAD_TAGS as readonly string[]).includes(tag) ? 'head' : 'body';
}

/** Every name `readTag` accepts, sorted — what a refusal quotes as "required". */
export function acceptedTagNames(): string[] {
  const names = new Set<string>(V3_TAGS);
  for (const t of [...SPLIT_TAGS, ...ARM_MERGED_SPLIT_TAGS]) {
    names.add(`${t}-r`);
    names.add(`${t}-l`);
  }
  return [...names].sort();
}

/** The mirror of a split layer name (`eyebrow-l` <-> `eyebrow-r`), or `null` for an unsided one. */
export function pairOf(name: string): string | null {
  const t = readTag(name);
  if (t === null || t.side === null) return null;
  return `${t.base}-${t.side === 'r' ? 'l' : 'r'}`;
}

/** The prefix of an author-made layer's name (issue #256): `author:<label>`. */
export const AUTHOR_PREFIX = 'author:';

/** An author-made layer's name read: the label after {@link AUTHOR_PREFIX}, and no tag, so no role. */
export interface AuthorTagReading {
  /** The name as the layer carries it: `author:hand`. */
  name: string;
  /** What follows the prefix: the author's own word, read by nothing as a role. */
  label: string;
  group: 'author';
}

/** What a layer name reads as: a See-through v3 tag, or an author-made layer's name. */
export type LayerTagReading = TagReading | AuthorTagReading;

/** What an author-made layer's label must be, as a refusal quotes it. */
export const AUTHOR_LABEL_RULE = 'a label that is not empty, does not start with "." or whitespace, does not end with whitespace, and holds no slash, backslash or colon';

/**
 * Whether `label` may follow {@link AUTHOR_PREFIX}. It becomes part of a part
 * name the plan proposes and of a file name the wrapper form may look for
 * (`parts/<name>.png`), so it is held to what a part name may be, and it holds
 * no colon, so the name keeps exactly one.
 */
export function authorLabelOk(label: string): boolean {
  return label !== '' && !label.startsWith('.') && label.trim() === label && !/[\\/:]/.test(label);
}

/** Read a layer name as an author-made layer's, or `null` when it is not one (no prefix, or a label {@link authorLabelOk} refuses). */
export function readAuthorTag(name: string): AuthorTagReading | null {
  if (!name.startsWith(AUTHOR_PREFIX)) return null;
  const label = name.slice(AUTHOR_PREFIX.length);
  return authorLabelOk(label) ? { name, label, group: 'author' } : null;
}

/** Read a layer name as a v3 tag or an author-made layer's name, or `null` when it is neither. */
export function readLayerTag(name: string): LayerTagReading | null {
  return readTag(name) ?? readAuthorTag(name);
}

/** Whether a tag string names an author-made layer. */
export function isAuthorTag(name: string): boolean {
  return readAuthorTag(name) !== null;
}

/**
 * Why `name` is no layer tag, as the detail of a `*_TAG_KNOWN` refusal: an
 * `author:` name whose label is refused says what the label must be; any
 * other names the accepted v3 tags and the author form.
 */
export function layerTagRequirement(name: string): string {
  if (name.endsWith(HIDDEN_SUFFIX)) {
    return `is a hidden-art layer's name (issue #359) for ${JSON.stringify(name.slice(0, -HIDDEN_SUFFIX.length))}, which is no layer name; ${HIDDEN_NAME_RULE} is required`;
  }
  if (name.startsWith(AUTHOR_PREFIX)) {
    return `is an author-made layer's name with the label ${JSON.stringify(name.slice(AUTHOR_PREFIX.length))}; ${AUTHOR_LABEL_RULE} is required after "${AUTHOR_PREFIX}"`;
  }
  return `is not a See-through v3 tag; one of ${acceptedTagNames().join(', ')} is required, or "${AUTHOR_PREFIX}<label>" for a layer the author made`;
}

/**
 * What every stage says of an author-made layer (issue #256), so it never
 * reads as a See-through layer: `layers` prints it per layer, `assemble` per
 * part, and `--propose-plan` and `propose` carry it in their notes.
 */
export const AUTHOR_NO_ROLE =
  'an author-made layer, not a See-through one: no tag, so no role — it rides the bone the config gives it (config.regions.<part>, or a mesh in config.meshes), and its draw position is its place in config.assemble.plan';

/** The `layers` line for an author-made layer. */
export function authorLayerLine(name: string): string {
  return `author-made: layer "${name}" — ${AUTHOR_NO_ROLE}`;
}

/**
 * ⭐ **A hidden-art layer** (issue #359) holds the art of a layer where
 * something else covers it — the forearm under the sleeve, the inside of the
 * knee, the shirt under a scarf's tail — painted by an artist who has it,
 * because See-through cannot see it. It is named by the layer it belongs to
 * and {@link HIDDEN_SUFFIX}: `handwear-r:hidden` is `handwear-r`'s art where
 * it is covered, `author:hand:hidden` is `author:hand`'s.
 *
 * Why this form and not `author:` with a declared target: the name alone says
 * what the layer is and whose it is, so every reader knows at read time that
 * it is not a part (the proposer never drafts one from it) and which layer it
 * belongs to, with no config field to agree with it. The suffix holds a colon,
 * which no v3 tag holds and an author-made label may not hold
 * ({@link AUTHOR_LABEL_RULE}), so `<name>:hidden` can never be read as a tag,
 * a side, or a label.
 *
 * It is never drawn and never a part. `assemble` reads it as the art the
 * layer's part takes where a stage takes art from under something: a cut's
 * `under` (issue #193) and a limb segment's cap (issue #349) — see
 * `hiddenArt` in `src/assemble.ts`.
 */
export const HIDDEN_SUFFIX = ':hidden';

/** A hidden-art layer's name read: the layer it belongs to. */
export interface HiddenTagReading {
  /** The name as the layer carries it: `handwear-r:hidden`. */
  name: string;
  /** The layer it belongs to: `handwear-r`, a v3 tag or an author-made layer's name. */
  of: string;
}

/**
 * Read a layer name as a hidden-art layer's, or `null` when it does not end in
 * {@link HIDDEN_SUFFIX} or what precedes it is no layer name ({@link readLayerTag}).
 */
export function readHiddenTag(name: string): HiddenTagReading | null {
  if (!name.endsWith(HIDDEN_SUFFIX)) return null;
  const of = name.slice(0, -HIDDEN_SUFFIX.length);
  return readLayerTag(of) === null ? null : { name, of };
}

/** What a hidden-art layer's name must be, as a refusal quotes it. */
export const HIDDEN_NAME_RULE = `"<layer>${HIDDEN_SUFFIX}", where <layer> is a See-through v3 tag or "${AUTHOR_PREFIX}<label>" that the same input also holds`;
