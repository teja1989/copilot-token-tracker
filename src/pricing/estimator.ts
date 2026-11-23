import { inferProvider, matchModelRate } from './catalog.js';

export interface CostInput {
  model: string;
  provider?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Optional provider-reported cost in USD (e.g., from Copilot nano_aiu or OTLP). */
  reportedCostUsd?: number | null;
}

export interface CostResult {
  provider: string;
  estimatedCostUsd: number;
  cacheSavingsUsd: number;
  copilotPremiumRequests?: number;
  costSource: 'provider-reported' | 'catalog-estimate' | 'unknown';
  tier: 'frontier' | 'standard' | 'fast' | 'local' | 'unknown';
}

export function estimateEventCost(input: CostInput): CostResult {
  const provider = inferProvider(input.model, input.provider);
  const rate = matchModelRate(input.model);

  const inTok = Math.max(0, input.inputTokens);
  const outTok = Math.max(0, input.outputTokens);
  const cacheReadTok = Math.max(0, input.cachedReadTokens ?? 0);
  const cacheWriteTok = Math.max(0, input.cacheWriteTokens ?? 0);

  if (typeof input.reportedCostUsd === 'number' && Number.isFinite(input.reportedCostUsd) && input.reportedCostUsd >= 0) {
    const cacheSavingsUsd = rate
      ? ((cacheReadTok / 1_000_000) * Math.max(0, rate.inputPer1M - rate.cachedReadPer1M))
      : 0;
    return {
      provider,
      estimatedCostUsd: roundUsd(input.reportedCostUsd),
      cacheSavingsUsd: roundUsd(cacheSavingsUsd),
      copilotPremiumRequests: rate?.copilotMultiplier,
      costSource: 'provider-reported',
      tier: rate?.tier ?? 'unknown',
    };
  }

  if (!rate) {
    return {
      provider,
      estimatedCostUsd: 0,
      cacheSavingsUsd: 0,
      costSource: 'unknown',
      tier: 'unknown',
    };
  }

  const inputCost = (inTok / 1_000_000) * rate.inputPer1M;
  const cachedReadCost = (cacheReadTok / 1_000_000) * rate.cachedReadPer1M;
  const cacheWriteCost = (cacheWriteTok / 1_000_000) * (rate.cacheWritePer1M ?? rate.inputPer1M);
  const outputCost = (outTok / 1_000_000) * rate.outputPer1M;

  const totalCost = inputCost + cachedReadCost + cacheWriteCost + outputCost;
  const cacheSavings = (cacheReadTok / 1_000_000) * Math.max(0, rate.inputPer1M - rate.cachedReadPer1M);

  return {
    provider,
    estimatedCostUsd: roundUsd(totalCost),
    cacheSavingsUsd: roundUsd(cacheSavings),
    copilotPremiumRequests: rate.copilotMultiplier,
    costSource: 'catalog-estimate',
    tier: rate.tier,
  };
}

function roundUsd(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}
