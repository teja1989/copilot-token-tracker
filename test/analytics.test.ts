import { describe, expect, it } from 'vitest';
import { buildWorkflowGraph, buildWorkflowSummaries } from '../src/analytics/agentGraph.js';
import { generateEfficiencyInsights } from '../src/analytics/insights.js';
import { computeDashboardMetrics } from '../src/analytics/metrics.js';
import type { TelemetryEvent } from '../src/model/types.js';
import { buildSimulatedWorkflowEvents } from '../src/simulator/multiAgentSim.js';

describe('Multi-Agent DAG & Metrics Analytics', () => {
  it('reconstructs nodes, handoff edges, depths, and critical path from a multi-agent swarm', () => {
    const events = buildSimulatedWorkflowEvents(0, 1_700_000_000_000);
    const summaries = buildWorkflowSummaries(events);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].agentCount).toBe(7);

    const graph = buildWorkflowGraph(events, summaries[0].workflowId);
    expect(graph).not.toBeNull();
    expect(graph!.nodes).toHaveLength(7);
    expect(graph!.edges.length).toBeGreaterThanOrEqual(6);
    expect(graph!.criticalPathAgentIds.length).toBeGreaterThanOrEqual(3);
    expect(graph!.collaboration.parallelismFactor).toBeGreaterThan(0);
    expect(graph!.collaboration.maxDelegationDepth).toBeGreaterThanOrEqual(2);
    expect(graph!.collaboration.totalHandoffs).toBeGreaterThanOrEqual(6);

    const root = graph!.nodes.find((n) => n.agentName === 'Lead Orchestrator');
    expect(root?.depth).toBe(0);
  });

  it('computes KPIs, model breakdown, top tools, and efficiency insights', () => {
    const events = [
      ...buildSimulatedWorkflowEvents(0, 1_700_000_000_000),
      ...buildSimulatedWorkflowEvents(1, 1_700_000_100_000),
    ];
    const metrics = computeDashboardMetrics(events, []);
    expect(metrics.kpis.totalRequests).toBe(events.length);
    expect(metrics.kpis.totalTokens).toBeGreaterThan(200_000);
    expect(metrics.kpis.totalCostUsd).toBeGreaterThan(0);
    expect(metrics.kpis.cacheSavingsUsd).toBeGreaterThan(0);
    expect(metrics.kpis.efficiencyScore).toBeGreaterThan(0);
    expect(metrics.kpis.efficiencyScore).toBeLessThanOrEqual(100);
    expect(metrics.byModel.length).toBeGreaterThanOrEqual(4);
    expect(metrics.topTools.length).toBeGreaterThan(0);
    expect(metrics.insights.length).toBeGreaterThan(0);
  });

  it('detects context snowballs, tool-call thrashing loops, and cache-busting custom agents', () => {
    const base: Omit<TelemetryEvent, 'id' | 'startTimeMs' | 'endTimeMs' | 'inputTokens' | 'cachedReadTokens' | 'totalTokens' | 'toolName'> = {
      source: 'sdk',
      workflowId: 'wf-custom',
      workflowName: 'Custom Agent Run',
      agentId: 'wf-custom:custom-bot',
      agentName: 'Custom Log Bot',
      agentRole: 'Coder',
      kind: 'tool',
      operation: 'tool:grep_search',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      outputTokens: 120,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0.1,
      cacheSavingsUsd: 0,
      costSource: 'catalog-estimate',
      durationMs: 1000,
      status: 'ok',
    };

    const spans: TelemetryEvent[] = [10_000, 25_000, 45_000, 70_000, 95_000].map((inTok, i) => ({
      ...base,
      id: `sp-${i}`,
      toolName: 'grep_search',
      inputTokens: inTok,
      cachedReadTokens: 500,
      totalTokens: inTok + 620,
      startTimeMs: 1_700_000_000_000 + i * 2000,
      endTimeMs: 1_700_000_001_000 + i * 2000,
    }));

    const insights = generateEfficiencyInsights(spans);
    const ids = insights.map((i) => i.id);
    expect(ids).toContain('context-snowball');
    expect(ids).toContain('tool-thrashing-loops');
    expect(ids).toContain('per-agent-cache-busting');
    expect(ids).toContain('prompt-output-stuffing');
    expect(insights.every((i) => Boolean(i.evidence))).toBe(true);
  });
});
