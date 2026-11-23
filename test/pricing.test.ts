import { describe, expect, it } from 'vitest';
import { inferProvider, matchModelRate } from '../src/pricing/catalog.js';
import { estimateEventCost } from '../src/pricing/estimator.js';

describe('Pricing Catalog & Estimator', () => {
  it('matches most-specific model pattern first', () => {
    expect(matchModelRate('gpt-5.4-nano')?.pattern).toBe('gpt-5.4-nano');
    expect(matchModelRate('gpt-5.4-mini')?.pattern).toBe('gpt-5.4-mini');
    expect(matchModelRate('gpt-5.4')?.pattern).toBe('gpt-5.4');
    expect(matchModelRate('claude-sonnet-4-6-20260514')?.provider).toBe('anthropic');
  });

  it('infers providers for unknown variants', () => {
    expect(inferProvider('claude-future-9')).toBe('anthropic');
    expect(inferProvider('gemini-5-ultra')).toBe('google');
    expect(inferProvider('llama3.3:70b')).toBe('local');
  });

  it('calculates uncached, cached read, cache write, and savings accurately', () => {
    const res = estimateEventCost({
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000, // $3.00
      cachedReadTokens: 1_000_000, // $0.30 (saves $2.70)
      cacheWriteTokens: 1_000_000, // $3.75
      outputTokens: 1_000_000, // $15.00
    });
    expect(res.costSource).toBe('catalog-estimate');
    expect(res.estimatedCostUsd).toBeCloseTo(22.05, 4);
    expect(res.cacheSavingsUsd).toBeCloseTo(2.7, 4);
  });

  it('prefers provider-reported cost when available', () => {
    const res = estimateEventCost({
      model: 'gpt-5.4',
      inputTokens: 1000,
      outputTokens: 500,
      reportedCostUsd: 0.042,
    });
    expect(res.costSource).toBe('provider-reported');
    expect(res.estimatedCostUsd).toBe(0.042);
  });

  it('prices local ollama/llama models at $0', () => {
    const res = estimateEventCost({
      model: 'ollama/qwen2.5-coder:32b',
      inputTokens: 50_000,
      outputTokens: 10_000,
    });
    expect(res.provider).toBe('local');
    expect(res.estimatedCostUsd).toBe(0);
  });
});
