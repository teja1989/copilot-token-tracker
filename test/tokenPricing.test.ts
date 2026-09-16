import { describe, expect, it } from 'vitest';
import { estimateDollarCost } from '../src/pricing/tokenPricing.js';
import { estimateEventCost } from '../src/pricing/estimateCost.js';
import type { ChatEvent } from '../src/model/events.js';

describe('estimateDollarCost', () => {
  it('bills cached tokens at the cached rate and fresh tokens at the input rate', () => {
    // gpt-4.1: input $2/1M, cached $0.5/1M, output $8/1M
    const result = estimateDollarCost('gpt-4.1-2025-04-14', 1_000_000, 200_000, 400_000, null);
    // fresh = 1,000,000 - 400,000 = 600,000 -> $1.20; cached 400,000 -> $0.20; output 200,000 -> $1.60
    expect(result.usd).toBeCloseTo(1.2 + 0.2 + 1.6, 5);
  });

  it('applies the Anthropic cache-write rate distinctly from the input rate', () => {
    // claude-sonnet-4.6: input $3/1M, cacheWrite $3.75/1M
    const withWrite = estimateDollarCost('claude-sonnet-4-6-20260201', 100_000, 50_000, 0, 100_000);
    const withoutWrite = estimateDollarCost('claude-sonnet-4-6-20260201', 100_000, 50_000, 0, 0);
    expect(withWrite.usd).toBeGreaterThan(withoutWrite.usd ?? 0);
  });

  it('returns null usd rather than a fabricated number for an unmatched model', () => {
    const result = estimateDollarCost('some-brand-new-model-2027', 1000, 500, 0, null);
    expect(result.usd).toBeNull();
    expect(result.matchedPattern).toBeNull();
  });
});

function chatEvent(overrides: Partial<ChatEvent>): ChatEvent {
  return {
    kind: 'chat',
    conversationId: 'c1',
    spanId: 's1',
    timestampMs: 0,
    provider: 'github',
    requestedModel: 'gpt-4o',
    resolvedModel: 'gpt-4o-2024-08-06',
    agentName: null,
    chatSessionId: null,
    turnIndex: null,
    inputTokens: 1000,
    outputTokens: 500,
    cachedTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    timeToFirstTokenMs: null,
    realCreditsUsd: null,
    ...overrides
  };
}

describe('estimateEventCost', () => {
  it('prefers real credits over any estimate when present', () => {
    const result = estimateEventCost(chatEvent({ resolvedModel: 'claude-sonnet-4-6-20260201', realCreditsUsd: 0.123 }));
    expect(result.usd).toBe(0.123);
    expect(result.usdSource).toBe('real');
    // Still computed independently for the legacy-plan case — not gated behind usd being absent.
    expect(result.premiumRequestUnits).toBe(9);
  });

  it('computes the token-rate $ estimate and the legacy multiplier units independently, not one gating the other', () => {
    const result = estimateEventCost(chatEvent({ resolvedModel: 'claude-sonnet-4-6-20260201' }));
    expect(result.usdSource).toBe('estimated_token_rate');
    expect(result.usd).not.toBeNull();
    expect(result.premiumRequestUnits).toBe(9);
  });

  it('falls back to no usd estimate when token counts are absent, while multiplier units remain available', () => {
    const result = estimateEventCost(chatEvent({ resolvedModel: 'claude-sonnet-4-6-20260201', inputTokens: null, outputTokens: null }));
    expect(result.usd).toBeNull();
    expect(result.usdSource).toBeNull();
    expect(result.premiumRequestUnits).toBe(9);
  });
});
