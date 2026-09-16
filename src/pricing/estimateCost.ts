import { PRICING_TABLE, type PricingConfidence } from './pricingTable.js';

export interface PremiumRequestEstimate {
  /** Premium-request-equivalent units this one chat span consumed, or null if unknown. */
  units: number | null;
  matchedPattern: string | null;
  confidence: PricingConfidence | 'no_match';
  pricingAsOf: string;
}

/**
 * Resolved model ids from the API (e.g. `gpt-4o-2024-08-06`,
 * `claude-sonnet-4-6-20260201`) use dashes and date suffixes, while pricing-table
 * patterns are transcribed from human-readable marketing names (e.g. `claude-sonnet-4.6`)
 * which use dots. Stripping all non-alphanumeric characters before comparing avoids a
 * silent match failure from that formatting mismatch alone.
 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Estimates premium-request consumption for a single chat span under the legacy
 * per-request multiplier billing model. This is deliberately NOT a dollar estimate —
 * see pricingTable.ts for why. `units` is independent of token counts by design: that's
 * how this billing model actually works (1 request × multiplier, not $/token).
 */
export function estimatePremiumRequestUnits(resolvedModel: string | null): PremiumRequestEstimate {
  if (!resolvedModel) {
    return { units: null, matchedPattern: null, confidence: 'no_match', pricingAsOf: PRICING_TABLE.asOf };
  }
  const normalized = normalizeForMatch(resolvedModel);
  // Longest pattern first so a more specific entry (e.g. "gpt-4.1") is preferred over a
  // shorter one that happens to also be a substring (e.g. "gpt-4").
  const sortedEntries = [...PRICING_TABLE.entries].sort((a, b) => b.modelPattern.length - a.modelPattern.length);
  const match = sortedEntries.find((entry) => normalized.includes(normalizeForMatch(entry.modelPattern)));
  if (!match) {
    return { units: null, matchedPattern: null, confidence: 'no_match', pricingAsOf: PRICING_TABLE.asOf };
  }
  return {
    units: match.multiplier,
    matchedPattern: match.modelPattern,
    confidence: match.confidence,
    pricingAsOf: PRICING_TABLE.asOf
  };
}
