import type { EfficiencyInsight, TelemetryEvent } from '../model/types.js';
import { matchModelRate } from '../pricing/catalog.js';

export function generateEfficiencyInsights(events: TelemetryEvent[]): EfficiencyInsight[] {
  if (events.length === 0) return [];
  const insights: EfficiencyInsight[] = [];

  // 1. Frontier model used on small/trivial turns (< 250 output tokens)
  const smallFrontierTurns = events.filter((e) => {
    const rate = matchModelRate(e.model);
    return rate?.tier === 'frontier' && e.outputTokens > 0 && e.outputTokens < 250 && e.estimatedCostUsd > 0;
  });
  if (smallFrontierTurns.length >= 3) {
    const spend = smallFrontierTurns.reduce((s, e) => s + e.estimatedCostUsd, 0);
    const models = Array.from(new Set(smallFrontierTurns.map((e) => e.model)));
    insights.push({
      id: 'frontier-on-small-turns',
      severity: spend > 0.5 ? 'high' : 'medium',
      category: 'cost',
      title: `${smallFrontierTurns.length} short turns routed to frontier models`,
      description: `${models.join(', ')} handled ${smallFrontierTurns.length} turns producing under 250 output tokens ($${spend.toFixed(3)} spent).`,
      recommendation:
        'Route lightweight classification, search summarization, and quick edits to a fast tier model (e.g., gemini-3-flash, claude-haiku-4.5, or gpt-5-mini) for up to 75% lower cost.',
      estimatedMonthlySavingsUsd: Math.round(spend * 0.75 * 10 * 100) / 100,
      affectedModels: models,
    });
  }

  // 2. Prompt cache hit rate analysis
  const totalInputSide = events.reduce((s, e) => s + e.inputTokens + e.cachedReadTokens, 0);
  const totalCached = events.reduce((s, e) => s + e.cachedReadTokens, 0);
  const totalCacheSavings = events.reduce((s, e) => s + e.cacheSavingsUsd, 0);
  const cacheRate = totalInputSide > 0 ? totalCached / totalInputSide : 0;

  if (totalInputSide > 50_000 && cacheRate < 0.25) {
    insights.push({
      id: 'low-prompt-cache-hit',
      severity: 'medium',
      category: 'caching',
      title: `Low prompt cache utilization (${Math.round(cacheRate * 100)}%)`,
      description: `Only ${Math.round(cacheRate * 100)}% of input tokens were served from prompt cache across ${events.length} calls.`,
      recommendation:
        'Keep system prompts, tool schemas, and shared repo context stable at the prefix of multi-agent calls so Anthropic/OpenAI/Gemini prompt caching activates.',
      estimatedMonthlySavingsUsd: Math.round((events.reduce((s, e) => s + e.estimatedCostUsd, 0) * 0.3) * 10 * 100) / 100,
    });
  } else if (totalCacheSavings >= 0.05 && cacheRate >= 0.4) {
    insights.push({
      id: 'strong-cache-savings',
      severity: 'positive',
      category: 'caching',
      title: `Strong prompt caching saved $${totalCacheSavings.toFixed(2)} (${Math.round(cacheRate * 100)}% hit rate)`,
      description: `${(totalCached / 1000).toFixed(1)}k input tokens were served from cache instead of full uncached rates.`,
      recommendation: 'Current prefix-sharing strategy across agent turns is working well—keep static instructions pinned at the top.',
    });
  }

  // 3. Error & retry loops
  const errors = events.filter((e) => e.status === 'error');
  if (errors.length >= 2) {
    const errorRate = errors.length / events.length;
    const wastedCost = errors.reduce((s, e) => s + e.estimatedCostUsd, 0);
    const agents = Array.from(new Set(errors.map((e) => e.agentName)));
    insights.push({
      id: 'agent-error-retries',
      severity: errorRate > 0.1 ? 'high' : 'medium',
      category: 'reliability',
      title: `${errors.length} failed spans (${(errorRate * 100).toFixed(1)}% error rate)`,
      description: `Agents (${agents.slice(0, 3).join(', ')}) encountered failures costing ~$${wastedCost.toFixed(3)} in retried work.`,
      recommendation:
        'Add schema validation before tool execution and cap automatic retry loops with exponential backoff to avoid runaway token burn.',
      affectedAgents: agents,
    });
  }

  // 4. Context bloat detection (turns with > 80k input+cached tokens)
  const heavyTurns = events.filter((e) => e.inputTokens + e.cachedReadTokens > 80_000);
  if (heavyTurns.length >= 2) {
    const agents = Array.from(new Set(heavyTurns.map((e) => e.agentName)));
    insights.push({
      id: 'context-window-bloat',
      severity: 'medium',
      category: 'orchestration',
      title: `${heavyTurns.length} calls exceeded 80K context tokens`,
      description: `Large context windows inflate latency and per-turn spend, especially in long-running coordinator loops (${agents.slice(0, 3).join(', ')}).`,
      recommendation:
        'Compact conversation history or delegate file exploration to isolated subagents that return concise summaries instead of raw file dumps.',
      affectedAgents: agents,
    });
  }

  // 5. High latency tail
  const sortedLatencies = events.map((e) => e.durationMs).sort((a, b) => a - b);
  const p95 = sortedLatencies[Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * 0.95))] ?? 0;
  if (p95 > 12_000 && events.length >= 5) {
    insights.push({
      id: 'high-p95-latency',
      severity: 'low',
      category: 'latency',
      title: `p95 turn latency is ${(p95 / 1000).toFixed(1)}s`,
      description: `Slow tail responses stall downstream agents waiting on handoffs in sequential chains.`,
      recommendation:
        'Fan out independent researcher/linter/test subagents in parallel instead of chaining them sequentially.',
    });
  }

  return insights;
}
