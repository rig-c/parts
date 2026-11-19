import { SHA256_PATTERN } from './editreceipt.ts';
import { PartsError } from './errors.ts';

const DIGEST_KEYS = ['checkpoint_sha256', 'graph_sha256', 'script_sha256'] as const;
type DigestKey = typeof DIGEST_KEYS[number];
export type ReceiptProducer = { tool: string; model?: string } & {
  [K in DigestKey]: Record<K, string> & Partial<Record<Exclude<DigestKey, K>, never>>
}[DigestKey];

export function receiptObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function receiptText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function parseReceiptProducer(value: unknown, object: string): ReceiptProducer {
  const digests = receiptObject(value) ? DIGEST_KEYS.filter(key => Object.hasOwn(value, key)) : [];
  const [digest] = digests;
  if (receiptObject(value) && receiptText(value.tool) &&
    (!Object.hasOwn(value, 'model') || receiptText(value.model)) &&
    digests.length === 1 && Object.keys(value).every(key => key === 'tool' || key === 'model' || key === digest)) {
    const hash = value[digest];
    if (typeof hash === 'string' && SHA256_PATTERN.test(hash)) {
      const names = { tool: value.tool, ...(typeof value.model === 'string' ? { model: value.model } : {}) };
      if (digest === 'checkpoint_sha256') return { ...names, checkpoint_sha256: hash };
      if (digest === 'graph_sha256') return { ...names, graph_sha256: hash };
      return { ...names, script_sha256: hash };
    }
  }
  throw new PartsError([{ code: 'RECEIPT_PRODUCER', object,
    detail: 'requires a nonblank tool, optional nonblank model, and exactly one lowercase SHA-256 in checkpoint_sha256, graph_sha256 or script_sha256' }]);
}

export function receiptProducerJson(text: string, object: string): ReceiptProducer {
  let value: unknown;
  try { value = JSON.parse(text); } catch { /* The shared parser names the refusal. */ }
  return parseReceiptProducer(value, object);
}
