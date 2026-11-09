/**
 * Part sources (issue #947): with `config.assemble.editor_receipts.trace_parts`
 * true, every part's pixels trace to a layer of the See-through split or to an
 * image an editor receipt covers (issue #946), and nothing else.
 *
 * Two kinds of input put pixels in a part that trace to neither, and both are
 * read off the config, never guessed from pixels:
 *
 * - **An edited image with no receipt** — an author-made or hidden-art layer,
 *   a cut's `under`, a limb segment's `cap`. `trace_parts` demands a receipt
 *   for each exactly as `editor_receipts.required` does
 *   (`ASSEMBLE_EDITOR_RECEIPT_MISSING`, `src/editreceipt.ts`).
 * - **A shape the author drew in the config** that decides which pixels a part
 *   holds: a cut's `polygon` (`assemble.cuts`, and each alternate set's own
 *   `cuts`), `seethrough.arm_split`'s column or line, a limb's `split.line`, a
 *   patch's `box` of the painting (`assemble.patches`) and a painting
 *   extension's `band` (`assemble.extend_painting`). A drawn edge through a
 *   layer's art is not an edge of the split, and it tears where the piece moves.
 *   `parts.json` cannot show all of these afterwards — an arm split's parts are
 *   recorded `full:handwear-r` and `full:handwear-l`, as See-through layers are
 *   — so the refusal is made on the config, before anything is assembled
 *   (`ASSEMBLE_PART_SOURCE`).
 *
 * What is NOT refused, and why: a limb's segments are cut at the joint the
 * rig's bones place (`config.limbs`, `jointLine` in `src/limbs.ts`), not along
 * a line the author drew, and a limb `split` with `edge: "painting"` follows the
 * painting's stroke; a `take` entry's layer is another See-through run's,
 * verified by its identity receipt (`taken_layers`); `extend_below_crop`
 * continues a part from a layer of the full run; the automatic stages
 * (projection, the seam override, the fringe push-back, the arm-run split by
 * colour) write within a layer's own footprint or derive their line from the
 * layers.
 *
 * Pure: reads the parsed config only.
 */
import type { AssembleConfig } from './config.ts';
import type { Problem } from './errors.ts';

const FLAG = 'config.assemble.editor_receipts.trace_parts';
const REQUIRED = `${FLAG} is true, so every part's pixels must trace to a layer of the See-through split or to an image with an editor receipt`;
const REMEDY = 'paint the piece as an author layer (author:<label>) in an image editor and record its receipt in config.assemble.editor_receipts, or take it whole from a layer of the split — never carve it by a shape drawn in the config';

const box = (b: readonly number[]): string => `[${b.join(', ')}]`;

/** Whether the config declares the gate. */
export function tracePartsDeclared(cfg: Pick<AssembleConfig, 'assemble'>): boolean {
  return cfg.assemble.editor_receipts?.trace_parts === true;
}

/**
 * Under `trace_parts`, one `ASSEMBLE_PART_SOURCE` per shape the config draws
 * through a part's pixels, naming the part (as `parts.json` names it), where
 * the config declares the shape, and the shape found. Absent the flag, none.
 * Order is the config's: cuts, each alternate set's cuts, patches, painting
 * extensions, the arm split, limb splits in key order.
 */
export function untracedPartSources(cfg: Pick<AssembleConfig, 'assemble' | 'seethrough' | 'limbs'>): Problem[] {
  if (!tracePartsDeclared(cfg)) return [];
  const out: Problem[] = [];
  const refuse = (object: string, found: string): void => {
    out.push({ code: 'ASSEMBLE_PART_SOURCE', object, detail: `${found}; ${REQUIRED} — ${REMEDY}` });
  };
  const a = cfg.assemble;
  (a.cuts ?? []).forEach((q, i) => {
    if (typeof q.under === 'object' && q.under !== null) return;
    refuse(`part "${q.into}" (config.assemble.cuts[${i}])`, `its pixels are carved out of part "${q.from}" by a hand-drawn ${q.polygon.length}-point polygon`);
  });
  (a.alternates ?? []).forEach((set, j) => {
    (set.cuts ?? []).forEach((q, i) => {
      if (typeof q.under === 'object' && q.under !== null) return;
      refuse(`part "${q.into}" (config.assemble.alternates[${j}].cuts[${i}], alternate set "${set.name}")`, `its pixels are carved out of part "${q.from}" by a hand-drawn ${q.polygon.length}-point polygon`);
    });
  });
  (a.patches ?? []).forEach((p, i) => {
    refuse(`part "${p.name}" (config.assemble.patches[${i}])`, `its pixels are the painting's inside a hand-drawn box ${box(p.box)} (alpha "${p.alpha}"), which no layer of the split holds`);
  });
  (a.extend_painting ?? []).forEach((e, i) => {
    refuse(`part "${e.part}" (config.assemble.extend_painting[${i}])`, `it gains the painting's pixels inside a hand-drawn band ${box(e.band)}, which no layer of the split holds there`);
  });
  const arm = cfg.seethrough.arm_split;
  if (arm !== undefined) {
    const shape = arm.x !== undefined ? `a hand-drawn column x = ${arm.x}` : `a hand-drawn ${(arm.line ?? []).length}-point line`;
    refuse('parts full:handwear-r and full:handwear-l (config.seethrough.arm_split)', `their pixels are split out of the full run's handwear layer along ${shape}`);
  }
  for (const name of Object.keys(cfg.limbs ?? {}).sort()) {
    const limb = (cfg.limbs ?? {})[name];
    const line = limb.split?.line;
    if (line === undefined) continue;
    const parts = limb.segments.map((s) => `"${s.part}"`).join(', ');
    refuse(`limb "${name}" parts ${parts} (config.limbs.${name}.split.line)`, `their pixels are split from the crossing limb's along a hand-drawn ${line.length}-point line; split.edge "painting" follows the painting's stroke instead`);
  }
  return out;
}
