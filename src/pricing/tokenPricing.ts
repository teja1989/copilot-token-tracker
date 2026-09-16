import { findBestMatch } from './modelMatch.js';

/**
 * Per-token $ pricing, in USD per 1,000,000 tokens.
 *
 * PROVENANCE, stated plainly: these numbers are NOT independently verified against
 * GitHub's own documentation from this environment (docs.github.com was unreachable
 * here — see PLAN.md). They are transcribed from a third-party open-source VS Code
 * extension (Hoxlegion/copilot-cost-tracker-vsc, `src/pricing/defaultPricing.ts`), whose
 * own comment cites "GitHub Docs 'Models and pricing for GitHub Copilot', June 3, 2026."
 * Treat this as "a credible secondhand source with a citation," not "verified firsthand."
 * Re-verify directly against GitHub's docs before using this for anything billing-
 * critical, and expect it to go stale — GitHub's Copilot pricing has changed more than
 * once in 2026 alone.
 *
 * `cacheWrite` only applies to Anthropic models, which is consistent with how Anthropic's
 * own API prices prompt-cache writes higher than cache reads — a real, independently
 * verifiable pricing structure, which is part of why this table is treated as credible
 * rather than fabricated.
 */
export interface TokenRate {
  modelPattern: string;
  input: number;
  cached: number;
  cacheWrite?: number;
  output: number;
}

export interface TokenPricingTable {
  version: string;
  effectiveDate: string;
  sourceNote: string;
  rates: TokenRate[];
}

export const TOKEN_PRICING_TABLE: TokenPricingTable = {
  version: '2026-06-03',
  effectiveDate: '2026-06-03',
  sourceNote:
    'Transcribed from a third-party OSS extension citing GitHub Docs "Models and pricing ' +
    'for GitHub Copilot" (2026-06-03). Not independently verified against docs.github.com ' +
    'from this environment. Re-verify before relying on it for billing-critical decisions.',
  rates: [
    { modelPattern: 'gpt-4.1', input: 2, cached: 0.5, output: 8 },
    { modelPattern: 'gpt-5-mini', input: 0.25, cached: 0.025, output: 2 },
    { modelPattern: 'gpt-5.2-codex', input: 1.75, cached: 0.175, output: 14 },
    { modelPattern: 'gpt-5.3-codex', input: 1.75, cached: 0.175, output: 14 },
    { modelPattern: 'gpt-5.2', input: 1.75, cached: 0.175, output: 14 },
    { modelPattern: 'gpt-5.4-mini', input: 0.75, cached: 0.075, output: 4.5 },
    { modelPattern: 'gpt-5.4-nano', input: 0.2, cached: 0.02, output: 1.25 },
    { modelPattern: 'gpt-5.4', input: 2.5, cached: 0.25, output: 15 },
    { modelPattern: 'gpt-5.5', input: 5, cached: 0.5, output: 30 },

    { modelPattern: 'claude-haiku-4.5', input: 1, cached: 0.1, cacheWrite: 1.25, output: 5 },
    { modelPattern: 'claude-sonnet-4.5', input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 },
    { modelPattern: 'claude-sonnet-4.6', input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 },
    { modelPattern: 'claude-sonnet-4', input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 },
    { modelPattern: 'claude-opus-4.5', input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },
    { modelPattern: 'claude-opus-4.6', input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },
    { modelPattern: 'claude-opus-4.7', input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },
    { modelPattern: 'claude-opus-4.8', input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 },

    { modelPattern: 'gemini-2.5-pro', input: 1.25, cached: 0.125, output: 10 },
    { modelPattern: 'gemini-3-flash', input: 0.5, cached: 0.05, output: 3 },
    { modelPattern: 'gemini-3.1-pro', input: 2, cached: 0.2, output: 12 },
    { modelPattern: 'gemini-3.5-flash', input: 1.5, cached: 0.15, output: 9 },

    { modelPattern: 'raptor-mini', input: 0.25, cached: 0.025, output: 2 },
    { modelPattern: 'mai-code-1-flash', input: 0.75, cached: 0.075, output: 4.5 }
  ]
};

export interface DollarCostEstimate {
  usd: number | null;
  matchedPattern: string | null;
  pricingVersion: string;
}

/**
 * Estimates $ cost for one chat event from token counts. `cachedTokens` are billed at the
 * `cached` rate rather than `input`, and any tokens not accounted for as cached are
 * treated as fresh input — this mirrors how the reference implementation computes it, and
 * matches how cache-aware providers actually bill.
 */
export function estimateDollarCost(
  resolvedModel: string | null,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number | null,
  cacheWriteTokens: number | null
): DollarCostEstimate {
  if (!resolvedModel) {
    return { usd: null, matchedPattern: null, pricingVersion: TOKEN_PRICING_TABLE.version };
  }
  const match = findBestMatch(resolvedModel, TOKEN_PRICING_TABLE.rates);
  if (!match) {
    return { usd: null, matchedPattern: null, pricingVersion: TOKEN_PRICING_TABLE.version };
  }

  const cached = Math.max(0, cachedTokens ?? 0);
  const freshInput = Math.max(0, inputTokens - cached);
  const cacheWrite = Math.max(0, cacheWriteTokens ?? 0);

  const usd =
    (freshInput / 1_000_000) * match.input +
    (cached / 1_000_000) * match.cached +
    (cacheWrite / 1_000_000) * (match.cacheWrite ?? match.input) +
    (outputTokens / 1_000_000) * match.output;

  return { usd, matchedPattern: match.modelPattern, pricingVersion: TOKEN_PRICING_TABLE.version };
}
