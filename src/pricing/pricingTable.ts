/**
 * GitHub Copilot's billing is a genuinely moving target: it switched from a pure
 * per-request "premium request" model (each non-base-model request consumes
 * `1 × model multiplier` premium requests, independent of token count) to a
 * usage-based "AI Credits" model rolling out from June 2026 for accounts that moved
 * off the legacy annual-plan billing. Both can be true for different users at once
 * depending on their plan.
 *
 * This table only encodes the LEGACY per-request multiplier system, seeded from
 * published figures as of the date below. It is explicitly NOT a source of truth —
 * treat every number here as needing reverification against
 * https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 * before trusting it for anything billing-critical. `confidence: 'reported'` means
 * "found in a secondary source with a citation," not "verified against GitHub's own
 * docs directly" (that page was unreachable from this environment when this table was
 * built — see PLAN.md).
 *
 * There is deliberately no dollar-per-token or dollar-per-credit table here: no
 * verified rate for the newer AI Credits system was available, and fabricating one
 * would produce a confidently wrong cost estimate, which is worse than showing none.
 */

export type PricingConfidence = 'reported' | 'unverified';

export interface ModelMultiplierEntry {
  /** Matched as a case-insensitive substring against the resolved model id. */
  modelPattern: string;
  /** Premium requests consumed per chat request when this model is used. */
  multiplier: number;
  confidence: PricingConfidence;
}

export interface PricingTable {
  asOf: string;
  billingModel: 'legacy-per-request-multiplier';
  note: string;
  entries: ModelMultiplierEntry[];
}

export const PRICING_TABLE: PricingTable = {
  asOf: '2026-09-16',
  billingModel: 'legacy-per-request-multiplier',
  note:
    'Applies to Copilot Pro/Pro+ accounts still on legacy annual-plan request-based ' +
    'billing. Accounts on the usage-based AI Credits model (rolling out since ' +
    '2026-06-01) are not represented here — see module docstring.',
  entries: [
    { modelPattern: 'gpt-4o', multiplier: 0, confidence: 'reported' },
    { modelPattern: 'gpt-4.1', multiplier: 0, confidence: 'reported' },
    { modelPattern: 'gemini-2.0-flash', multiplier: 0.25, confidence: 'reported' },
    { modelPattern: 'gpt-5-mini', multiplier: 0.33, confidence: 'reported' },
    { modelPattern: 'claude-haiku-4.5', multiplier: 0.33, confidence: 'reported' },
    { modelPattern: 'gpt-5.4', multiplier: 6, confidence: 'reported' },
    { modelPattern: 'claude-sonnet-4.6', multiplier: 9, confidence: 'reported' },
    { modelPattern: 'claude-opus-4.8', multiplier: 27, confidence: 'reported' },
    { modelPattern: 'gpt-4.5', multiplier: 50, confidence: 'reported' },
    { modelPattern: 'gpt-5.5', multiplier: 57, confidence: 'reported' }
  ]
};
