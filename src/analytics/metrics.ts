import type {
  DashboardMetrics,
  DiscoveredSourceStatus,
  ModelUsageSummary,
  ProjectUsageSummary,
  SourceKind,
  SourceUsageSummary,
  TelemetryEvent,
  TimeSeriesBucket,
} from '../model/types.js';
import { generateEfficiencyInsights } from './insights.js';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function roundUsd(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

export function computeDashboardMetrics(
  events: TelemetryEvent[],
  sources: DiscoveredSourceStatus[],
): DashboardMetrics {
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedReadTokens = 0;
  let cacheWriteTokens = 0;
  let reasoningTokens = 0;
  let totalCostUsd = 0;
  let cacheSavingsUsd = 0;
  let errorCount = 0;

  const workflows = new Set<string>();
  const agents = new Set<string>();
  const latencies: number[] = [];

  const modelMap = new Map<
    string,
    ModelUsageSummary & { latencies: number[]; latencySum: number }
  >();
  const sourceMap = new Map<
    SourceKind,
    {
      requests: number;
      workflows: Set<string>;
      agents: Set<string>;
      totalTokens: number;
      estimatedCostUsd: number;
      lastSeenMs: number;
    }
  >();
  const toolMap = new Map<
    string,
    { calls: number; errors: number; durationSum: number; totalTokens: number }
  >();
  const projectMap = new Map<
    string,
    {
      workflows: Set<string>;
      agents: Set<string>;
      requests: number;
      totalTokens: number;
      inputTokens: number;
      cachedReadTokens: number;
      estimatedCostUsd: number;
      lastSeenMs: number;
    }
  >();

  for (const ev of events) {
    totalTokens += ev.totalTokens;
    inputTokens += ev.inputTokens;
    outputTokens += ev.outputTokens;
    cachedReadTokens += ev.cachedReadTokens;
    cacheWriteTokens += ev.cacheWriteTokens;
    reasoningTokens += ev.reasoningTokens;
    totalCostUsd += ev.estimatedCostUsd;
    cacheSavingsUsd += ev.cacheSavingsUsd;
    if (ev.status === 'error') errorCount++;

    workflows.add(ev.workflowId);
    agents.add(ev.agentId);
    latencies.push(ev.durationMs);

    // By model
    let m = modelMap.get(ev.model);
    if (!m) {
      m = {
        model: ev.model,
        provider: ev.provider,
        requests: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        cacheSavingsUsd: 0,
        cacheHitRate: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        latencies: [],
        latencySum: 0,
      };
      modelMap.set(ev.model, m);
    }
    m.requests++;
    if (ev.status === 'error') m.errors++;
    m.inputTokens += ev.inputTokens;
    m.outputTokens += ev.outputTokens;
    m.cachedReadTokens += ev.cachedReadTokens;
    m.cacheWriteTokens += ev.cacheWriteTokens;
    m.reasoningTokens += ev.reasoningTokens;
    m.totalTokens += ev.totalTokens;
    m.estimatedCostUsd += ev.estimatedCostUsd;
    m.cacheSavingsUsd += ev.cacheSavingsUsd;
    m.latencies.push(ev.durationMs);
    m.latencySum += ev.durationMs;

    // By source
    let s = sourceMap.get(ev.source);
    if (!s) {
      s = {
        requests: 0,
        workflows: new Set(),
        agents: new Set(),
        totalTokens: 0,
        estimatedCostUsd: 0,
        lastSeenMs: ev.endTimeMs,
      };
      sourceMap.set(ev.source, s);
    }
    s.requests++;
    s.workflows.add(ev.workflowId);
    s.agents.add(ev.agentId);
    s.totalTokens += ev.totalTokens;
    s.estimatedCostUsd += ev.estimatedCostUsd;
    if (ev.endTimeMs > s.lastSeenMs) s.lastSeenMs = ev.endTimeMs;

    // By project / repo
    const projName = ev.project?.trim() || 'Unassigned';
    let p = projectMap.get(projName);
    if (!p) {
      p = {
        workflows: new Set(),
        agents: new Set(),
        requests: 0,
        totalTokens: 0,
        inputTokens: 0,
        cachedReadTokens: 0,
        estimatedCostUsd: 0,
        lastSeenMs: ev.endTimeMs,
      };
      projectMap.set(projName, p);
    }
    p.workflows.add(ev.workflowId);
    p.agents.add(ev.agentId);
    p.requests++;
    p.totalTokens += ev.totalTokens;
    p.inputTokens += ev.inputTokens;
    p.cachedReadTokens += ev.cachedReadTokens;
    p.estimatedCostUsd += ev.estimatedCostUsd;
    if (ev.endTimeMs > p.lastSeenMs) p.lastSeenMs = ev.endTimeMs;

    // By tool
    if (ev.toolName) {
      let t = toolMap.get(ev.toolName);
      if (!t) {
        t = { calls: 0, errors: 0, durationSum: 0, totalTokens: 0 };
        toolMap.set(ev.toolName, t);
      }
      t.calls++;
      if (ev.status === 'error') t.errors++;
      t.durationSum += ev.durationMs;
      t.totalTokens += ev.totalTokens;
    }
  }

  latencies.sort((a, b) => a - b);
  const avgLatencyMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const p95LatencyMs = Math.round(percentile(latencies, 0.95));

  const promptSide = inputTokens + cachedReadTokens;
  const cacheHitRate = promptSide > 0 ? cachedReadTokens / promptSide : 0;
  const errorRate = events.length > 0 ? errorCount / events.length : 0;

  // Composite Efficiency Score (0-100)
  const cacheScore = Math.min(40, Math.round(cacheHitRate * 50));
  const reliabilityScore = Math.max(0, Math.round((1 - errorRate * 4) * 35));
  const latencyScore = p95LatencyMs === 0 ? 25 : Math.max(5, Math.min(25, Math.round(25 - (p95LatencyMs / 20_000) * 15)));
  const efficiencyScore = events.length === 0 ? 100 : Math.min(100, Math.max(10, cacheScore + reliabilityScore + latencyScore));

  const byModel: ModelUsageSummary[] = Array.from(modelMap.values())
    .map((m) => {
      m.latencies.sort((a, b) => a - b);
      const pSide = m.inputTokens + m.cachedReadTokens;
      return {
        model: m.model,
        provider: m.provider,
        requests: m.requests,
        errors: m.errors,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cachedReadTokens: m.cachedReadTokens,
        cacheWriteTokens: m.cacheWriteTokens,
        reasoningTokens: m.reasoningTokens,
        totalTokens: m.totalTokens,
        estimatedCostUsd: roundUsd(m.estimatedCostUsd),
        cacheSavingsUsd: roundUsd(m.cacheSavingsUsd),
        cacheHitRate: pSide > 0 ? m.cachedReadTokens / pSide : 0,
        avgLatencyMs: m.requests > 0 ? Math.round(m.latencySum / m.requests) : 0,
        p95LatencyMs: Math.round(percentile(m.latencies, 0.95)),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const bySource: SourceUsageSummary[] = Array.from(sourceMap.entries())
    .map(([source, s]) => ({
      source,
      requests: s.requests,
      workflows: s.workflows.size,
      agents: s.agents.size,
      totalTokens: s.totalTokens,
      estimatedCostUsd: roundUsd(s.estimatedCostUsd),
      lastSeenMs: s.lastSeenMs,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const byProject: ProjectUsageSummary[] = Array.from(projectMap.entries())
    .map(([project, p]) => {
      const pSide = p.inputTokens + p.cachedReadTokens;
      return {
        project,
        workflows: p.workflows.size,
        requests: p.requests,
        agents: p.agents.size,
        totalTokens: p.totalTokens,
        cachedReadTokens: p.cachedReadTokens,
        cacheHitRate: pSide > 0 ? p.cachedReadTokens / pSide : 0,
        estimatedCostUsd: roundUsd(p.estimatedCostUsd),
        lastSeenMs: p.lastSeenMs,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const topTools = Array.from(toolMap.entries())
    .map(([toolName, t]) => ({
      toolName,
      calls: t.calls,
      errors: t.errors,
      avgDurationMs: t.calls > 0 ? Math.round(t.durationSum / t.calls) : 0,
      totalTokens: t.totalTokens,
    }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);

  return {
    generatedAtMs: Date.now(),
    kpis: {
      totalTokens,
      inputTokens,
      outputTokens,
      cachedReadTokens,
      cacheWriteTokens,
      reasoningTokens,
      totalCostUsd: roundUsd(totalCostUsd),
      cacheSavingsUsd: roundUsd(cacheSavingsUsd),
      cacheHitRate,
      totalRequests: events.length,
      totalWorkflows: workflows.size,
      uniqueAgents: agents.size,
      avgLatencyMs,
      p95LatencyMs,
      errorRate,
      efficiencyScore,
    },
    timeSeries: buildTimeSeries(events),
    byModel,
    bySource,
    byProject,
    topTools,
    insights: generateEfficiencyInsights(events),
    sources,
  };
}

function buildTimeSeries(events: TelemetryEvent[]): TimeSeriesBucket[] {
  if (events.length === 0) return [];
  const minTs = events[0].startTimeMs;
  const maxTs = events[events.length - 1].endTimeMs;
  const spanMs = Math.max(60_000, maxTs - minTs);

  // Adaptive bucket size: 1m, 5m, 1h, or 1d
  let bucketMs = 60_000;
  let fmt: (d: Date) => string;
  if (spanMs > 3 * 24 * 3600_000) {
    bucketMs = 24 * 3600_000;
    fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  } else if (spanMs > 6 * 3600_000) {
    bucketMs = 3600_000;
    fmt = (d) => `${String(d.getHours()).padStart(2, '0')}:00`;
  } else if (spanMs > 30 * 60_000) {
    bucketMs = 5 * 60_000;
    fmt = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } else {
    bucketMs = 60_000;
    fmt = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const buckets = new Map<number, TimeSeriesBucket>();
  for (const ev of events) {
    const key = Math.floor(ev.startTimeMs / bucketMs) * bucketMs;
    let b = buckets.get(key);
    if (!b) {
      b = {
        timestampMs: key,
        label: fmt(new Date(key)),
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        requests: 0,
        errors: 0,
      };
      buckets.set(key, b);
    }
    b.inputTokens += ev.inputTokens;
    b.outputTokens += ev.outputTokens;
    b.cachedReadTokens += ev.cachedReadTokens;
    b.cacheWriteTokens += ev.cacheWriteTokens;
    b.reasoningTokens += ev.reasoningTokens;
    b.totalTokens += ev.totalTokens;
    b.costUsd = roundUsd(b.costUsd + ev.estimatedCostUsd);
    b.requests++;
    if (ev.status === 'error') b.errors++;
  }

  return Array.from(buckets.values()).sort((a, b) => a.timestampMs - b.timestampMs);
}
