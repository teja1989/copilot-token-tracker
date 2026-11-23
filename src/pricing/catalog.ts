export interface ModelRate {
  /** Case-insensitive substring matched from most-specific (longest) to least-specific. */
  pattern: string;
  provider: string;
  /** USD per 1,000,000 uncached input tokens. */
  inputPer1M: number;
  /** USD per 1,000,000 cached read tokens. */
  cachedReadPer1M: number;
  /** USD per 1,000,000 cache write tokens (Anthropic prompt caching). */
  cacheWritePer1M?: number;
  /** USD per 1,000,000 output tokens (including reasoning tokens unless billed separately). */
  outputPer1M: number;
  /** Optional legacy GitHub Copilot premium-request multiplier. */
  copilotMultiplier?: number;
  tier: 'frontier' | 'standard' | 'fast' | 'local';
}

export const MODEL_CATALOG: ModelRate[] = [
  // OpenAI
  { pattern: 'gpt-5.5', provider: 'openai', inputPer1M: 5.0, cachedReadPer1M: 0.5, outputPer1M: 30.0, copilotMultiplier: 57, tier: 'frontier' },
  { pattern: 'gpt-5.4-nano', provider: 'openai', inputPer1M: 0.2, cachedReadPer1M: 0.02, outputPer1M: 1.25, tier: 'fast' },
  { pattern: 'gpt-5.4-mini', provider: 'openai', inputPer1M: 0.75, cachedReadPer1M: 0.075, outputPer1M: 4.5, tier: 'standard' },
  { pattern: 'gpt-5.4', provider: 'openai', inputPer1M: 2.5, cachedReadPer1M: 0.25, outputPer1M: 15.0, copilotMultiplier: 6, tier: 'frontier' },
  { pattern: 'gpt-5.3-codex', provider: 'openai', inputPer1M: 1.75, cachedReadPer1M: 0.175, outputPer1M: 14.0, tier: 'frontier' },
  { pattern: 'gpt-5.2-codex', provider: 'openai', inputPer1M: 1.75, cachedReadPer1M: 0.175, outputPer1M: 14.0, tier: 'frontier' },
  { pattern: 'gpt-5.1-codex', provider: 'openai', inputPer1M: 1.5, cachedReadPer1M: 0.15, outputPer1M: 12.0, tier: 'frontier' },
  { pattern: 'gpt-5.2', provider: 'openai', inputPer1M: 1.75, cachedReadPer1M: 0.175, outputPer1M: 14.0, tier: 'frontier' },
  { pattern: 'gpt-5-mini', provider: 'openai', inputPer1M: 0.25, cachedReadPer1M: 0.025, outputPer1M: 2.0, copilotMultiplier: 0.33, tier: 'fast' },
  { pattern: 'gpt-5', provider: 'openai', inputPer1M: 1.25, cachedReadPer1M: 0.125, outputPer1M: 10.0, tier: 'frontier' },
  { pattern: 'gpt-4.5', provider: 'openai', inputPer1M: 75.0, cachedReadPer1M: 37.5, outputPer1M: 150.0, copilotMultiplier: 50, tier: 'frontier' },
  { pattern: 'gpt-4.1-mini', provider: 'openai', inputPer1M: 0.4, cachedReadPer1M: 0.1, outputPer1M: 1.6, tier: 'fast' },
  { pattern: 'gpt-4.1-nano', provider: 'openai', inputPer1M: 0.1, cachedReadPer1M: 0.025, outputPer1M: 0.4, tier: 'fast' },
  { pattern: 'gpt-4.1', provider: 'openai', inputPer1M: 2.0, cachedReadPer1M: 0.5, outputPer1M: 8.0, copilotMultiplier: 0, tier: 'standard' },
  { pattern: 'gpt-4o-mini', provider: 'openai', inputPer1M: 0.15, cachedReadPer1M: 0.075, outputPer1M: 0.6, tier: 'fast' },
  { pattern: 'gpt-4o', provider: 'openai', inputPer1M: 2.5, cachedReadPer1M: 1.25, outputPer1M: 10.0, copilotMultiplier: 0, tier: 'standard' },
  { pattern: 'o3-mini', provider: 'openai', inputPer1M: 1.1, cachedReadPer1M: 0.55, outputPer1M: 4.4, tier: 'standard' },
  { pattern: 'o4-mini', provider: 'openai', inputPer1M: 1.1, cachedReadPer1M: 0.275, outputPer1M: 4.4, tier: 'standard' },
  { pattern: 'o3', provider: 'openai', inputPer1M: 2.0, cachedReadPer1M: 0.5, outputPer1M: 8.0, tier: 'frontier' },

  // Anthropic
  { pattern: 'claude-opus-4-8', provider: 'anthropic', inputPer1M: 5.0, cachedReadPer1M: 0.5, cacheWritePer1M: 6.25, outputPer1M: 25.0, copilotMultiplier: 27, tier: 'frontier' },
  { pattern: 'claude-opus-4.8', provider: 'anthropic', inputPer1M: 5.0, cachedReadPer1M: 0.5, cacheWritePer1M: 6.25, outputPer1M: 25.0, copilotMultiplier: 27, tier: 'frontier' },
  { pattern: 'claude-opus-4-7', provider: 'anthropic', inputPer1M: 5.0, cachedReadPer1M: 0.5, cacheWritePer1M: 6.25, outputPer1M: 25.0, tier: 'frontier' },
  { pattern: 'claude-opus-4.7', provider: 'anthropic', inputPer1M: 5.0, cachedReadPer1M: 0.5, cacheWritePer1M: 6.25, outputPer1M: 25.0, tier: 'frontier' },
  { pattern: 'claude-opus-4-6', provider: 'anthropic', inputPer1M: 5.0, cachedReadPer1M: 0.5, cacheWritePer1M: 6.25, outputPer1M: 25.0, tier: 'frontier' },
  { pattern: 'claude-opus-4.6', provider: 'anthropic', inputPer1M: 5.0, cachedReadPer1M: 0.5, cacheWritePer1M: 6.25, outputPer1M: 25.0, tier: 'frontier' },
  { pattern: 'claude-opus-4', provider: 'anthropic', inputPer1M: 15.0, cachedReadPer1M: 1.5, cacheWritePer1M: 18.75, outputPer1M: 75.0, tier: 'frontier' },
  { pattern: 'claude-sonnet-5', provider: 'anthropic', inputPer1M: 3.0, cachedReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15.0, tier: 'frontier' },
  { pattern: 'claude-sonnet-4-6', provider: 'anthropic', inputPer1M: 3.0, cachedReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15.0, copilotMultiplier: 9, tier: 'standard' },
  { pattern: 'claude-sonnet-4.6', provider: 'anthropic', inputPer1M: 3.0, cachedReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15.0, copilotMultiplier: 9, tier: 'standard' },
  { pattern: 'claude-sonnet-4-5', provider: 'anthropic', inputPer1M: 3.0, cachedReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15.0, tier: 'standard' },
  { pattern: 'claude-sonnet-4.5', provider: 'anthropic', inputPer1M: 3.0, cachedReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15.0, tier: 'standard' },
  { pattern: 'claude-sonnet-4', provider: 'anthropic', inputPer1M: 3.0, cachedReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15.0, tier: 'standard' },
  { pattern: 'claude-3-7-sonnet', provider: 'anthropic', inputPer1M: 3.0, cachedReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15.0, tier: 'standard' },
  { pattern: 'claude-3-5-sonnet', provider: 'anthropic', inputPer1M: 3.0, cachedReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15.0, tier: 'standard' },
  { pattern: 'claude-haiku-4-5', provider: 'anthropic', inputPer1M: 1.0, cachedReadPer1M: 0.1, cacheWritePer1M: 1.25, outputPer1M: 5.0, copilotMultiplier: 0.33, tier: 'fast' },
  { pattern: 'claude-haiku-4.5', provider: 'anthropic', inputPer1M: 1.0, cachedReadPer1M: 0.1, cacheWritePer1M: 1.25, outputPer1M: 5.0, copilotMultiplier: 0.33, tier: 'fast' },
  { pattern: 'claude-3-5-haiku', provider: 'anthropic', inputPer1M: 0.8, cachedReadPer1M: 0.08, cacheWritePer1M: 1.0, outputPer1M: 4.0, tier: 'fast' },

  // Google Gemini
  { pattern: 'gemini-4', provider: 'google', inputPer1M: 2.0, cachedReadPer1M: 0.2, outputPer1M: 12.0, tier: 'frontier' },
  { pattern: 'gemini-3.1-pro', provider: 'google', inputPer1M: 2.0, cachedReadPer1M: 0.2, outputPer1M: 12.0, tier: 'frontier' },
  { pattern: 'gemini-3-pro', provider: 'google', inputPer1M: 2.0, cachedReadPer1M: 0.2, outputPer1M: 12.0, tier: 'frontier' },
  { pattern: 'gemini-3-flash', provider: 'google', inputPer1M: 0.5, cachedReadPer1M: 0.05, outputPer1M: 3.0, tier: 'fast' },
  { pattern: 'gemini-2.5-pro', provider: 'google', inputPer1M: 1.25, cachedReadPer1M: 0.125, outputPer1M: 10.0, tier: 'frontier' },
  { pattern: 'gemini-2.5-flash', provider: 'google', inputPer1M: 0.3, cachedReadPer1M: 0.03, outputPer1M: 2.5, tier: 'fast' },
  { pattern: 'gemini-2.0-flash', provider: 'google', inputPer1M: 0.1, cachedReadPer1M: 0.025, outputPer1M: 0.4, copilotMultiplier: 0.25, tier: 'fast' },
  { pattern: 'gemini', provider: 'google', inputPer1M: 1.25, cachedReadPer1M: 0.125, outputPer1M: 8.0, tier: 'standard' },

  // DeepSeek / xAI / Local
  { pattern: 'deepseek-r1', provider: 'deepseek', inputPer1M: 0.55, cachedReadPer1M: 0.14, outputPer1M: 2.19, tier: 'standard' },
  { pattern: 'deepseek-v3', provider: 'deepseek', inputPer1M: 0.27, cachedReadPer1M: 0.07, outputPer1M: 1.1, tier: 'fast' },
  { pattern: 'grok-3', provider: 'xai', inputPer1M: 3.0, cachedReadPer1M: 0.75, outputPer1M: 15.0, tier: 'frontier' },
  { pattern: 'llama', provider: 'local', inputPer1M: 0, cachedReadPer1M: 0, outputPer1M: 0, tier: 'local' },
  { pattern: 'qwen', provider: 'local', inputPer1M: 0, cachedReadPer1M: 0, outputPer1M: 0, tier: 'local' },
  { pattern: 'ollama', provider: 'local', inputPer1M: 0, cachedReadPer1M: 0, outputPer1M: 0, tier: 'local' },
];

const SORTED_CATALOG = [...MODEL_CATALOG].sort((a, b) => b.pattern.length - a.pattern.length);

export function matchModelRate(model: string): ModelRate | null {
  const norm = model.trim().toLowerCase();
  if (!norm) return null;
  for (const entry of SORTED_CATALOG) {
    if (norm.includes(entry.pattern)) {
      return entry;
    }
  }
  return null;
}

export function inferProvider(model: string, explicitProvider?: string | null): string {
  if (explicitProvider && explicitProvider.trim() && explicitProvider !== 'unknown') {
    return explicitProvider.trim().toLowerCase();
  }
  const matched = matchModelRate(model);
  if (matched) return matched.provider;
  const norm = model.toLowerCase();
  if (norm.includes('claude')) return 'anthropic';
  if (norm.includes('gpt') || norm.startsWith('o1') || norm.startsWith('o3') || norm.startsWith('o4')) return 'openai';
  if (norm.includes('gemini')) return 'google';
  if (norm.includes('deepseek')) return 'deepseek';
  if (norm.includes('grok')) return 'xai';
  if (norm.includes('mistral')) return 'mistral';
  return 'other';
}
