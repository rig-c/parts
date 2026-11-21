/**
 * The config updates proposed by the CLI (issues #356, #671, #679):
 * no file reads/writes and no substitute for the stage's existing validator.
 * A present proposal section replaces that whole field; an absent optional
 * section is retained. `proposal-missing` (issue #671, `--only-missing`) instead
 * adds only resolvable `meshes` / `regions` entries for parts not already attached
 * by meshes, regions, limbs or patches, and appends skip diagnostics to the
 * proposal notes. The caller supplies the proposer's own section tuple,
 * avoiding a second policy list or a runtime import of the proposer graph.
 */
import type { PlanProposal } from './assemble.ts';
import type { HeadBoxProposal } from './headbox.ts';
import type { CharacterConfig } from './config.ts';
import { orderedEditedPartReceipt, type EditedPartReceipt } from './editedparts.ts';
import type { Proposal, PROPOSAL_CONFIG_SECTIONS } from './propose.ts';
import { PartsError } from './errors.ts';
import { parseConfig, parseEarlyConfig, parseProposalSections } from './config.ts';
import type { ConfigEdit } from './meshdraft.ts';

export type ConfigJson = null | boolean | number | string | ConfigJson[] | ConfigObject;
export interface ConfigObject { [key: string]: ConfigJson }
export type ConfigWritePatch =
  | { kind: 'edited-part-receipt'; receipt: EditedPartReceipt }
  | { kind: 'neck-unit'; config: CharacterConfig }
  | { kind: 'head-box'; head_box: HeadBoxProposal['head_box'] }
  | { kind: 'assemble-plan'; plan: PlanProposal['plan']; extend_below_crop: PlanProposal['extend_below_crop'] }
  | { kind: 'proposal'; proposal: Proposal; sections: typeof PROPOSAL_CONFIG_SECTIONS }
  /** Issues #671/#679: add unattached, resolvable entries; append skip explanations to the proposal's notes for the caller to print. */
  | { kind: 'proposal-missing'; proposal: Proposal; parts: ReadonlyArray<{ name: string; from: string }> }
  /** `bust-landmarks --write-config` (issue #1382): set or remove named shape fields of one part's existing
   * `meshes.<part>.contour.bust`; a field with no value is removed, every other key is kept where it is. */
  | { kind: 'bust-shape'; part: string; fields: ReadonlyArray<{ key: BustShapeKey; value?: number | string }> };
/** The `contour.bust` fields the landmarks file does not carry, the only ones a `bust-shape` patch writes. */
export type BustShapeKey = 'alpha' | 'clearance' | 'spacing' | 'bone_r' | 'bone_l';
export interface ConfigWriteChange {
  path: string;
  kind: 'added' | 'replaced' | 'removed';
  /** The value written, where the path alone does not say it (an array element added, issue #671). */
  value?: string;
}
export interface ConfigWriteResult {
  config: ConfigObject;
  /** Semantic changes only, in destination key order, then new key order. */
  changes: ConfigWriteChange[];
  /** Whole owned values, applied by the same splicedEdits engine as cloth. */
  edits: ConfigEdit[];
}
const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function field(parent: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? `${parent}${parent === '' ? '' : '.'}${key}` : `${parent}[${JSON.stringify(key)}]`;
}
function refuse(path: string, detail: string): never {
  throw new PartsError([{ code: 'CONFIG_FIELD_TYPE', object: path, detail }]);
}
/** Clone JSON without dropping undefined, accepting non-finite numbers or following cycles. */
function clone(value: unknown, path: string, ancestors = new Set<object>()): ConfigJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null) return refuse(path, `is ${typeof value}; a finite JSON value is required`);
  if (ancestors.has(value)) return refuse(path, 'contains a cycle; JSON values cannot refer to their ancestors');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return refuse(path, 'is not a plain JSON object');
  ancestors.add(value);
  let result: ConfigJson;
  if (Array.isArray(value)) {
    result = Array.from(value, (v, i) => clone(v, `${path}[${i}]`, ancestors));
  } else {
    // fromEntries keeps a JSON key named __proto__ as data, never as a setter.
    result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v, field(path, k), ancestors)]));
  }
  ancestors.delete(value);
  return result;
}
function equal(a: ConfigJson, b: ConfigJson): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!object(a) || !object(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => own(b, k) && equal(a[k], b[k]));
}
function changes(before: ConfigObject, after: ConfigObject, parent = ''): ConfigWriteChange[] {
  const result: ConfigWriteChange[] = [];
  for (const [key, a] of Object.entries(before)) {
    const path = field(parent, key);
    if (!own(after, key)) result.push({ path, kind: 'removed' });
    else if (!equal(a, after[key])) {
      if (object(a) && object(after[key])) result.push(...changes(a, after[key] as ConfigObject, path));
      else result.push({ path, kind: 'replaced' });
    }
  }
  for (const key of Object.keys(after)) if (!own(before, key)) result.push({ path: field(parent, key), kind: 'added' });
  return result;
}

/** The caller validates the returned candidate through its existing config door before saving it.
 * Receipt patches can also read a source config through the assembly door.
 */
export function mergeConfigProposal(raw: unknown, patch: ConfigWritePatch, receiptDoor: 'full' | 'assemble' = 'full'): ConfigWriteResult {
  if (!object(raw)) return refuse('config', 'is not an object; an existing config JSON object is required');
  const before = clone(raw, 'config') as ConfigObject;
  const config = clone(before, 'config') as ConfigObject;
  const edits: ConfigEdit[] = [];
  switch (patch.kind) {
    case 'edited-part-receipt': {
      const checked = receiptDoor === 'assemble' ? parseEarlyConfig(before, 'assemble') : parseConfig(before);
      const spec = checked.assemble.edited_parts;
      if (spec === undefined) throw new PartsError([{ code: 'EDITED_PART_BLOCK', object: 'config.assemble.edited_parts', detail: 'has no assemble.edited_parts; declare {dir, receipts: []} before recording an edited part' }]);
      const { part } = patch.receipt;
      if (!checked.assemble.plan.some(([name]) => name === part)) throw new PartsError([{ code: 'ASSEMBLE_EDITED_PART_UNKNOWN', object: part, detail: 'is not in assemble.plan; an existing plan part is required' }]);
      const found = spec.receipts.findIndex(row => row.part === part);
      const index = found === -1 ? spec.receipts.length : found;
      const value = clone(orderedEditedPartReceipt(patch.receipt), 'receipt');
      const receipts = ((config.assemble as ConfigObject).edited_parts as ConfigObject).receipts as ConfigJson[];
      if (found !== -1 && equal(receipts[index], value)) return { config, changes: [], edits: [] };
      receipts[index] = value;
      // This patch owns one row, never the ledger or the whole assemble block.
      return { config, changes: [{ path: `assemble.edited_parts.receipts[${index}]`, kind: found === -1 ? 'added' : 'replaced' }],
        edits: [{ path: ['assemble', 'edited_parts', 'receipts', index], value, insert: found === -1 }] };
    }
    case 'neck-unit': {
      const values = { bones: patch.config.bones, meshes: patch.config.meshes, regions: patch.config.regions, turn: patch.config.turn };
      for (const [key, value] of Object.entries(values)) {
        config[key] = clone(value, `neck.${key}`);
        if (!equal(before[key], config[key])) edits.push({ path: [key], value: config[key] });
      }
      if (!object(config.assemble)) return refuse('config.assemble', 'must be an object before drafting the neck source');
      config.assemble.plan = clone(patch.config.assemble.plan, 'neck.plan');
      if (!equal((before.assemble as ConfigObject).plan, config.assemble.plan)) edits.push({ path: ['assemble', 'plan'], value: config.assemble.plan });
      break;
    }

    case 'head-box': {
      if (!object(config.seethrough)) return refuse('config.seethrough', 'is absent or not an object; the existing See-through settings are required before writing head_box');
      const previous = config.seethrough.head_box;
      config.seethrough.head_box = clone(patch.head_box, 'proposal.head_box');
      if (!equal(previous, config.seethrough.head_box)) edits.push({ path: ['seethrough', 'head_box'], value: config.seethrough.head_box });
      break;
    }
    case 'assemble-plan': {
      if (!object(config.assemble)) return refuse('config.assemble', 'is absent or not an object; the existing assembly settings are required before writing its plan');
      const previousPlan = config.assemble.plan, previousExtend = config.assemble.extend_below_crop;
      config.assemble.plan = clone(patch.plan, 'proposal.plan');
      config.assemble.extend_below_crop = clone(patch.extend_below_crop, 'proposal.extend_below_crop');
      if (!equal(previousPlan, config.assemble.plan)) edits.push({ path: ['assemble', 'plan'], value: config.assemble.plan });
      if (!equal(previousExtend, config.assemble.extend_below_crop)) edits.push({ path: ['assemble', 'extend_below_crop'], value: config.assemble.extend_below_crop });
      break;
    }
    case 'proposal': {
      for (const key of patch.sections) {
        // This is the caller's checked Proposal, with the proposer's own tuple.
        // Optional absent fields are retained rather than erased by a narrower run.
        if (patch.proposal[key] !== undefined) {
          const previous = config[key];
          config[key] = clone(patch.proposal[key], `proposal.${key}`);
          if (!equal(previous, config[key])) edits.push({ path: [key], value: config[key] });
        }
      }
      break;
    }
    case 'proposal-missing': {
      // Read attachment ownership from the destination, even without --keypoints. A limb's source is consumed;
      // the loader requires regions for its segment parts instead. Patches are always regions.
      const attachments = new Map<string, string>();
      for (const section of ['meshes', 'regions'] as const) {
        if (config[section] !== undefined && !object(config[section])) return refuse(`config.${section}`, 'is not an object; an object of part entries is required before an entry is added to it');
        if (object(config[section])) for (const part of Object.keys(config[section])) attachments.set(part, field(`config.${section}`, part));
      }
      if (object(config.limbs)) for (const [limb, spec] of Object.entries(config.limbs)) {
        if (object(spec) && Array.isArray(spec.segments)) for (const segment of spec.segments) {
          if (object(segment) && typeof segment.from === 'string') attachments.set(segment.from, `${field('config.limbs', limb)} (source cut into its segment parts)`);
        }
      }
      if (object(config.assemble) && Array.isArray(config.assemble.patches)) for (const patch of config.assemble.patches) {
        if (object(patch) && typeof patch.name === 'string') attachments.set(patch.name, 'config.assemble.patches (a patch is always a region)');
      }
      // This mode appends diagnostics to the proposal's existing notes output, never to the destination config.
      const note = (part: string, why: string): void => {
        const line = `--only-missing: skipped part "${part}" — ${why}; no entry or plan row added`;
        if (!patch.proposal.notes.includes(line)) patch.proposal.notes.push(line);
      };
      const proposed = new Set([...patch.parts.map((p) => p.name), ...Object.keys(patch.proposal.meshes), ...Object.keys(patch.proposal.regions), ...Object.values(patch.proposal.limbs ?? {}).flatMap((l) => l.segments.map((s) => s.from))]);
      for (const part of proposed) {
        const by = attachments.get(part);
        if (by !== undefined) note(part, `already attached by ${by}`);
      }
      const entries: Array<{ section: 'meshes' | 'regions'; part: string; value: ConfigJson }> = [];
      const accepted = new Set<string>();
      for (const section of ['meshes', 'regions'] as const) for (const [part, entry] of Object.entries(patch.proposal[section])) {
        if (attachments.has(part) || accepted.has(part)) continue;
        const value = clone(entry, field(`proposal.${section}`, part));
        // Reuse the loader's own bone/chain expansion and mesh reference checks (including auto region names),
        // against CONFIG bones, never the draft's bones. Coverage and all retained fields still pass through the
        // caller's full config gate. Other entries are absent here so a forward dependency cannot leak from a draft.
        try {
          parseProposalSections({ bones: config.bones, meshes: section === 'meshes' ? { [part]: value } : {}, regions: section === 'regions' ? { [part]: value } : {}, motion: config.motion });
        } catch (error) {
          if (!(error instanceof PartsError)) throw error;
          const at = `proposal.${section}.${part}`;
          const problems = error.problems.filter((p) => p.object === at || p.object.startsWith(`${at}.`) || p.object.startsWith(`${at}[`));
          if (problems.length > 0) {
            note(part, problems.map((p) => `${p.code}: ${p.object.replace(/^proposal\./, 'config.')} — ${p.detail}`).join('; '));
            continue;
          }
        }
        entries.push({ section, part, value });
        accepted.add(part);
      }
      const added: ConfigWriteChange[] = [];
      // The #490 split's parts the plan does not name, each row where `mergedArmSplitPlan` puts it: the drape just
      // before the full run's handwear-<s> row, the hand just after it. A part of any other origin is not planned here.
      const assemble = config.assemble;
      const plan = object(assemble) && Array.isArray(assemble.plan) ? assemble.plan : null;
      if (plan !== null) {
        const row = (e: ConfigJson): [string, string, string] | null =>
          Array.isArray(e) && e.length === 3 && e.every((x) => typeof x === 'string') ? (e as [string, string, string]) : null;
        for (const part of patch.parts) {
          if (!accepted.has(part.name)) continue;
          const m = /^full:(drape|hand)-([rl])$/.exec(part.from);
          if (m === null) continue;
          if (plan.some((e) => { const r = row(e); return r !== null && (r[0] === part.name || (r[1] === 'full' && r[2] === `${m[1]}-${m[2]}`)); })) continue;
          const arm = plan.findIndex((e) => { const r = row(e); return r !== null && r[1] === 'full' && r[2] === `handwear-${m[2]}`; });
          if (arm < 0) continue;
          const at = m[1] === 'drape' ? arm : arm + 1;
          const value: ConfigJson = [part.name, 'full', `${m[1]}-${m[2]}`];
          plan.splice(at, 0, value);
          edits.push({ path: ['assemble', 'plan', at], value, insert: true, inline: true });
          added.push({ path: `assemble.plan[${at}]`, kind: 'added', value: JSON.stringify(value) });
        }
      }
      for (const { section, part, value } of entries) {
        if (!object(config[section])) config[section] = {};
        (config[section] as ConfigObject)[part] = value;
        edits.push({ path: [section, part], value });
        added.push({ path: field(section, part), kind: 'added' });
      }
      return { config, changes: added, edits };
    }
    case 'bust-shape': {
      const at = `${field('config.meshes', patch.part)}.contour.bust`;
      const meshes = config.meshes;
      const mesh = object(meshes) && own(meshes, patch.part) ? meshes[patch.part] : undefined;
      const contour = object(mesh) ? mesh.contour : undefined;
      const bust = object(contour) ? contour.bust : undefined;
      if (!object(contour) || !object(bust)) return refuse(at, 'is absent or not an object; an existing contour.bust is required before its shape fields are written');
      const next = clone(bust, at) as ConfigObject;
      for (const { key, value } of patch.fields) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      contour.bust = next;
      // This patch owns the one bust object, never the mesh or its other contour fields.
      if (!equal(bust as ConfigObject, next)) edits.push({ path: ['meshes', patch.part, 'contour', 'bust'], value: next });
      break;
    }
    default: return refuse('write-config', 'has no supported operation; edited-part-receipt, neck-unit, head-box, assemble-plan, proposal, proposal-missing or bust-shape is required');
  }
  return { config, changes: changes(before, config), edits };
}
