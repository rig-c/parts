/**
 * The three config updates proposed by the CLI (issue #356). Pure JSON merge:
 * no file reads/writes and no substitute for the stage's existing validator.
 * A present proposal section replaces that whole field; an absent optional
 * section is retained. The caller supplies the proposer's own section tuple,
 * avoiding a second policy list or a runtime import of the proposer graph.
 */
import type { PlanProposal } from './assemble.ts';
import type { HeadBoxProposal } from './headbox.ts';
import type { Proposal, PROPOSAL_CONFIG_SECTIONS } from './propose.ts';
import { PartsError } from './errors.ts';
import type { ConfigEdit } from './meshdraft.ts';

export type ConfigJson = null | boolean | number | string | ConfigJson[] | ConfigObject;
export interface ConfigObject { [key: string]: ConfigJson }
export type ConfigWritePatch =
  | { kind: 'head-box'; head_box: HeadBoxProposal['head_box'] }
  | { kind: 'assemble-plan'; plan: PlanProposal['plan']; extend_below_crop: PlanProposal['extend_below_crop'] }
  | { kind: 'proposal'; proposal: Proposal; sections: typeof PROPOSAL_CONFIG_SECTIONS };
export interface ConfigWriteChange {
  path: string;
  kind: 'added' | 'replaced' | 'removed';
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

/** The caller validates the returned candidate through its existing config door before saving it. */
export function mergeConfigProposal(raw: unknown, patch: ConfigWritePatch): ConfigWriteResult {
  if (!object(raw)) return refuse('config', 'is not an object; an existing config JSON object is required');
  const before = clone(raw, 'config') as ConfigObject;
  const config = clone(before, 'config') as ConfigObject;
  const edits: ConfigEdit[] = [];
  switch (patch.kind) {
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
    default: return refuse('write-config', 'has no supported operation; head-box, assemble-plan or proposal is required');
  }
  return { config, changes: changes(before, config), edits };
}
