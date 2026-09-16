import { describe, expect, it } from 'vitest';
import { estimatePremiumRequestUnits } from '../src/pricing/estimateCost.js';

describe('estimatePremiumRequestUnits', () => {
  it('matches a base model despite date-suffixed resolved id (multiplier 0)', () => {
    const result = estimatePremiumRequestUnits('gpt-4o-2024-08-06');
    expect(result.units).toBe(0);
    expect(result.matchedPattern).toBe('gpt-4o');
  });

  it('matches a dotted marketing-name pattern against a dash-and-date resolved id', () => {
    // Regression case: pricing table pattern "claude-sonnet-4.6" must still match a
    // real resolved model id like "claude-sonnet-4-6-20260201" (dashes, not dots).
    const result = estimatePremiumRequestUnits('claude-sonnet-4-6-20260201');
    expect(result.units).toBe(9);
    expect(result.confidence).toBe('reported');
  });

  it('prefers the more specific/longer pattern when multiple could match', () => {
    const result = estimatePremiumRequestUnits('gpt-5.5-2026-05-01');
    expect(result.units).toBe(57);
    expect(result.matchedPattern).toBe('gpt-5.5');
  });

  it('returns no_match rather than a fabricated number for an unknown model', () => {
    const result = estimatePremiumRequestUnits('some-future-model-nobody-has-heard-of');
    expect(result.units).toBeNull();
    expect(result.confidence).toBe('no_match');
  });

  it('returns no_match for a null model without throwing', () => {
    const result = estimatePremiumRequestUnits(null);
    expect(result.units).toBeNull();
    expect(result.confidence).toBe('no_match');
  });
});
