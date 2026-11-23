import { describe, expect, it } from 'vitest';
import { buildWorkflowGraph, buildWorkflowSummaries } from '../src/analytics/agentGraph.js';
import { computeDashboardMetrics } from '../src/analytics/metrics.js';
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
});
