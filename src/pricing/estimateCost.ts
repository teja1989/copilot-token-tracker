import { PRICING_TABLE, type PricingConfidence } from './pricingTable.js';
import { estimateDollarCost } from './tokenPricing.js';
import { findBestMatch } from './modelMatch.js';
import type { ChatEvent } from '../model/events.js';

export interface PremiumRequestEstimate {
  /** Premium-request-equivalent units this one chat span consumed, or null if unknown. */
  units: number | null;
  matchedPattern: string | null;
  confidence: PricingConfidence | 'no_match';
  pricingAsOf: string;
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
  const match = findBestMatch(resolvedModel, PRICING_TABLE.entries);
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

export type UsdSource = 'real' | 'estimated_token_rate';

export interface EventCostEstimate {
  /** Best-available dollar figure: GitHub's own real credit usage when present, else our token-rate estimate. Null if neither is computable. */
  usd: number | null;
  usdSource: UsdSource | null;
  /**
   * Computed independently of `usd`, not as a fallback: a legacy-multiplier account and a
   * usage-based-billing account are mutually exclusive real-world plans, and we don't know
   * which one the current user is on. Silently preferring whichever estimate happened to
   * resolve first would present a confidently wrong number under the plan that doesn't
   * apply. Both are surfaced; the caller (or a future "which plan am I on" setting)
   * decides which is relevant.
   */
  premiumRequestUnits: number | null;
  premiumRequestConfidence: PricingConfidence | 'no_match';
}

export function estimateEventCost(event: ChatEvent): EventCostEstimate {
  const multiplierEstimate = estimatePremiumRequestUnits(event.resolvedModel);

  if (event.realCreditsUsd != null) {
    return {
      usd: event.realCreditsUsd,
      usdSource: 'real',
      premiumRequestUnits: multiplierEstimate.units,
      premiumRequestConfidence: multiplierEstimate.confidence
    };
  }

  let usd: number | null = null;
  let usdSource: UsdSource | null = null;
  if (event.inputTokens != null && event.outputTokens != null) {
    const dollarEstimate = estimateDollarCost(
      event.resolvedModel,
      event.inputTokens,
      event.outputTokens,
      event.cachedTokens,
      event.cacheWriteTokens
    );
    if (dollarEstimate.usd != null) {
      usd = dollarEstimate.usd;
      usdSource = 'estimated_token_rate';
    }
  }

  return {
    usd,
    usdSource,
    premiumRequestUnits: multiplierEstimate.units,
    premiumRequestConfidence: multiplierEstimate.confidence
  };
}
