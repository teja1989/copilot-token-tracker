/**
 * The exact JSON shape written by Copilot Chat's `file` OTel exporter is not confirmed
 * against a real captured sample yet (see PLAN.md). OTel's own OTLP/JSON encoding
 * represents span attributes as an array of `{key, value: {stringValue|intValue|...}}`
 * pairs, but simple file/debug exporters often flatten this to a plain object instead.
 * This module supports both so the normalizer above it doesn't have to guess or break
 * once we validate against a real fixture — only this file changes if the real shape
 * turns out to be something else entirely.
 */

export type OtlpAttributeValue =
  | { stringValue: string }
  | { intValue: number | string }
  | { doubleValue: number }
  | { boolValue: boolean };

export interface OtlpKeyValue {
  key: string;
  value: OtlpAttributeValue;
}

export type AttributeBag = Record<string, unknown> | OtlpKeyValue[] | undefined | null;

function unwrapOtlpValue(value: OtlpAttributeValue): string | number | boolean | null {
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return typeof value.intValue === 'string' ? Number(value.intValue) : value.intValue;
  if ('doubleValue' in value) return value.doubleValue;
  if ('boolValue' in value) return value.boolValue;
  return null;
}

function isOtlpKeyValueArray(attrs: AttributeBag): attrs is OtlpKeyValue[] {
  return Array.isArray(attrs);
}

export function getAttr(attrs: AttributeBag, key: string): string | number | boolean | null {
  if (attrs == null) return null;
  if (isOtlpKeyValueArray(attrs)) {
    const found = attrs.find((kv) => kv && kv.key === key);
    return found ? unwrapOtlpValue(found.value) : null;
  }
  const raw = (attrs as Record<string, unknown>)[key];
  if (raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
  return null;
}

export function getStringAttr(attrs: AttributeBag, key: string): string | null {
  const v = getAttr(attrs, key);
  return typeof v === 'string' ? v : v == null ? null : String(v);
}

export function getNumberAttr(attrs: AttributeBag, key: string): number | null {
  const v = getAttr(attrs, key);
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
