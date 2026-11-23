import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { LocalCollector } from '../src/ingest/collector.js';
import { startServer } from '../src/server.js';
import { TelemetryStore } from '../src/store/telemetryStore.js';

describe('AgentPulse HTTP Server API', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const store = new TelemetryStore({ persistPath: null });
    const collector = new LocalCollector(store, { homeDir: '/nonexistent-test-home' });
    const started = await startServer({ store, collector }, 0, '127.0.0.1');
    server = started.server;
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 4318;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('serves health, ingests SDK & OTLP events, runs simulator, and returns DAG graph', async () => {
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    expect(health.status).toBe('ok');

    // Ingest custom SDK event
    const ingestRes = await fetch(`${baseUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'wf-test-1',
        workflowName: 'Test Workflow',
        agentName: 'Lead',
        agentRole: 'Coordinator',
        model: 'claude-sonnet-4-6',
        inputTokens: 2000,
        cachedReadTokens: 8000,
        outputTokens: 600,
      }),
    });
    expect(ingestRes.status).toBe(202);

    // Trigger instant multi-agent simulation
    const simRes = await fetch(`${baseUrl}/api/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instant: true, scenarioIndex: 0 }),
    });
    expect(simRes.status).toBe(202);
    const simJson = (await simRes.json()) as { workflowId: string; eventCount: number };
    expect(simJson.eventCount).toBeGreaterThan(5);

    // Fetch workflow graph
    const graphRes = await fetch(`${baseUrl}/api/workflows/${encodeURIComponent(simJson.workflowId)}/graph`);
    expect(graphRes.status).toBe(200);
    const graph = (await graphRes.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(graph.nodes.length).toBe(7);
    expect(graph.edges.length).toBeGreaterThanOrEqual(6);

    // Fetch metrics
    const metrics = (await fetch(`${baseUrl}/api/metrics`).then((r) => r.json())) as {
      kpis: { totalRequests: number; totalTokens: number };
      byProject: Array<{ project: string; totalTokens: number }>;
    };
    expect(metrics.kpis.totalRequests).toBe(1 + simJson.eventCount);
    expect(metrics.byProject.length).toBeGreaterThanOrEqual(2);

    // Fetch config endpoint
    const cfg = (await fetch(`${baseUrl}/api/config`).then((r) => r.json())) as {
      config: { vscodeDirs: string[] };
      globalConfigPath: string;
    };
    expect(Array.isArray(cfg.config.vscodeDirs)).toBe(true);
    expect(cfg.globalConfigPath).toContain('.agentpulse');

    // Fetch export snapshot
    const exp = (await fetch(`${baseUrl}/api/export`).then((r) => r.json())) as {
      version: string;
      summary: { totalRequests: number };
      events: unknown[];
    };
    expect(exp.version).toBe('1.0.0');
    expect(exp.summary.totalRequests).toBe(1 + simJson.eventCount);
    expect(exp.events.length).toBe(1 + simJson.eventCount);

    // Clear simulated data and confirm live event stays
    await fetch(`${baseUrl}/api/simulate`, { method: 'DELETE' });
    const afterClear = (await fetch(`${baseUrl}/api/metrics`).then((r) => r.json())) as {
      kpis: { totalRequests: number };
    };
    expect(afterClear.kpis.totalRequests).toBe(1);
  });
});
