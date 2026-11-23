import { randomUUID } from 'node:crypto';
import type { SpanKind, SpanStatus, TelemetryEvent } from '../model/types.js';
import { estimateEventCost } from '../pricing/estimator.js';
import type { TelemetryStore } from '../store/telemetryStore.js';

interface SimStep {
  agentKey: string;
  agentName: string;
  agentRole: string;
  parentAgentKey?: string;
  kind: SpanKind;
  operation: string;
  toolName?: string;
  model: string;
  inputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  offsetMs: number;
  durationMs: number;
  status?: SpanStatus;
  errorMessage?: string;
}

interface SimScenario {
  name: string;
  project: string;
  steps: SimStep[];
}

const SCENARIOS: SimScenario[] = [
  {
    name: 'OAuth2 + RBAC Service Migration',
    project: 'platform-auth',
    steps: [
      {
        agentKey: 'orchestrator',
        agentName: 'Lead Orchestrator',
        agentRole: 'Coordinator',
        kind: 'llm',
        operation: 'plan.decompose',
        model: 'claude-opus-4-6',
        inputTokens: 4200,
        cachedReadTokens: 12500,
        cacheWriteTokens: 3200,
        outputTokens: 1150,
        offsetMs: 0,
        durationMs: 2400,
      },
      {
        agentKey: 'researcher',
        agentName: 'Codebase Researcher',
        agentRole: 'Researcher',
        parentAgentKey: 'orchestrator',
        kind: 'tool',
        operation: 'tool:grep_search',
        toolName: 'grep_search',
        model: 'gemini-3-flash',
        inputTokens: 6400,
        cachedReadTokens: 18200,
        outputTokens: 820,
        offsetMs: 2500,
        durationMs: 1600,
      },
      {
        agentKey: 'architect',
        agentName: 'Schema Architect',
        agentRole: 'Planner',
        parentAgentKey: 'orchestrator',
        kind: 'llm',
        operation: 'design.spec',
        model: 'gpt-5.4',
        inputTokens: 5100,
        cachedReadTokens: 9800,
        outputTokens: 1940,
        reasoningTokens: 640,
        offsetMs: 2600,
        durationMs: 3100,
      },
      {
        agentKey: 'backend',
        agentName: 'Backend Engineer',
        agentRole: 'Coder',
        parentAgentKey: 'architect',
        kind: 'tool',
        operation: 'tool:edit_file',
        toolName: 'edit_file',
        model: 'claude-sonnet-4-6',
        inputTokens: 8900,
        cachedReadTokens: 34200,
        cacheWriteTokens: 4100,
        outputTokens: 3450,
        offsetMs: 5900,
        durationMs: 4200,
      },
      {
        agentKey: 'frontend',
        agentName: 'UI Engineer',
        agentRole: 'Coder',
        parentAgentKey: 'architect',
        kind: 'tool',
        operation: 'tool:edit_file',
        toolName: 'edit_file',
        model: 'claude-sonnet-4-6',
        inputTokens: 7100,
        cachedReadTokens: 26500,
        outputTokens: 2890,
        offsetMs: 6000,
        durationMs: 3800,
      },
      {
        agentKey: 'security',
        agentName: 'Security Auditor',
        agentRole: 'Reviewer',
        parentAgentKey: 'backend',
        kind: 'llm',
        operation: 'audit.jwt_scopes',
        model: 'claude-opus-4-6',
        inputTokens: 3100,
        cachedReadTokens: 22400,
        outputTokens: 1420,
        offsetMs: 10300,
        durationMs: 2900,
      },
      {
        agentKey: 'tester',
        agentName: 'Verification Runner',
        agentRole: 'Tester',
        parentAgentKey: 'backend',
        kind: 'tool',
        operation: 'tool:run_tests',
        toolName: 'run_tests',
        model: 'gpt-5-mini',
        inputTokens: 2800,
        cachedReadTokens: 6400,
        outputTokens: 410,
        offsetMs: 10400,
        durationMs: 1800,
        status: 'error',
        errorMessage: '2 integration tests failed: token expiry skew',
      },
      {
        agentKey: 'backend',
        agentName: 'Backend Engineer',
        agentRole: 'Coder',
        parentAgentKey: 'tester',
        kind: 'tool',
        operation: 'tool:edit_file',
        toolName: 'edit_file',
        model: 'claude-sonnet-4-6',
        inputTokens: 4200,
        cachedReadTokens: 39800,
        outputTokens: 980,
        offsetMs: 12400,
        durationMs: 2100,
      },
      {
        agentKey: 'tester',
        agentName: 'Verification Runner',
        agentRole: 'Tester',
        parentAgentKey: 'backend',
        kind: 'tool',
        operation: 'tool:run_tests',
        toolName: 'run_tests',
        model: 'gpt-5-mini',
        inputTokens: 1900,
        cachedReadTokens: 8400,
        outputTokens: 310,
        offsetMs: 14700,
        durationMs: 1500,
      },
      {
        agentKey: 'orchestrator',
        agentName: 'Lead Orchestrator',
        agentRole: 'Coordinator',
        kind: 'llm',
        operation: 'summary.finalize',
        model: 'claude-opus-4-6',
        inputTokens: 1800,
        cachedReadTokens: 28000,
        outputTokens: 190,
        offsetMs: 16400,
        durationMs: 1300,
      },
    ],
  },
  {
    name: 'Production Latency Spike Root-Cause & Fix',
    project: 'checkout-api',
    steps: [
      {
        agentKey: 'incident-lead',
        agentName: 'Incident Commander',
        agentRole: 'Coordinator',
        kind: 'llm',
        operation: 'triage.plan',
        model: 'gpt-5.4',
        inputTokens: 3600,
        cachedReadTokens: 8200,
        outputTokens: 920,
        reasoningTokens: 480,
        offsetMs: 0,
        durationMs: 2100,
      },
      {
        agentKey: 'log-analyst',
        agentName: 'Trace & Log Analyst',
        agentRole: 'Researcher',
        parentAgentKey: 'incident-lead',
        kind: 'tool',
        operation: 'tool:query_logs',
        toolName: 'query_logs',
        model: 'gemini-3-flash',
        inputTokens: 12400,
        cachedReadTokens: 24000,
        outputTokens: 1350,
        offsetMs: 2200,
        durationMs: 1900,
      },
      {
        agentKey: 'db-profiler',
        agentName: 'SQL Query Profiler',
        agentRole: 'Researcher',
        parentAgentKey: 'incident-lead',
        kind: 'tool',
        operation: 'tool:explain_analyze',
        toolName: 'explain_analyze',
        model: 'claude-haiku-4.5',
        inputTokens: 5400,
        cachedReadTokens: 11000,
        outputTokens: 780,
        offsetMs: 2300,
        durationMs: 1500,
      },
      {
        agentKey: 'patch-dev',
        agentName: 'Hotfix Engineer',
        agentRole: 'Coder',
        parentAgentKey: 'db-profiler',
        kind: 'tool',
        operation: 'tool:edit_file',
        toolName: 'edit_file',
        model: 'claude-sonnet-4-6',
        inputTokens: 6100,
        cachedReadTokens: 31500,
        cacheWriteTokens: 2900,
        outputTokens: 2100,
        offsetMs: 4300,
        durationMs: 3200,
      },
      {
        agentKey: 'load-tester',
        agentName: 'Load Benchmark Agent',
        agentRole: 'Tester',
        parentAgentKey: 'patch-dev',
        kind: 'tool',
        operation: 'tool:k6_bench',
        toolName: 'k6_bench',
        model: 'gpt-5-mini',
        inputTokens: 2200,
        cachedReadTokens: 7100,
        outputTokens: 460,
        offsetMs: 7700,
        durationMs: 2600,
      },
      {
        agentKey: 'incident-lead',
        agentName: 'Incident Commander',
        agentRole: 'Coordinator',
        kind: 'llm',
        operation: 'postmortem.draft',
        model: 'gpt-5.4',
        inputTokens: 2400,
        cachedReadTokens: 16500,
        outputTokens: 1120,
        offsetMs: 10500,
        durationMs: 1800,
      },
    ],
  },
];

let scenarioCursor = 0;

export function buildSimulatedWorkflowEvents(scenarioIndex?: number, baseTimeMs?: number): TelemetryEvent[] {
  const idx = scenarioIndex !== undefined ? scenarioIndex % SCENARIOS.length : scenarioCursor++ % SCENARIOS.length;
  const scenario = SCENARIOS[idx];
  const runId = randomUUID().slice(0, 6);
  const workflowId = `sim:${runId}`;
  const startBase = baseTimeMs ?? Date.now() - 20_000;

  return scenario.steps.map((step, i) => {
    const startTimeMs = startBase + step.offsetMs;
    const endTimeMs = startTimeMs + step.durationMs;
    const cacheWrite = step.cacheWriteTokens ?? 0;
    const reasoning = step.reasoningTokens ?? 0;
    const totalTokens =
      step.inputTokens + step.cachedReadTokens + cacheWrite + step.outputTokens + reasoning;

    const cost = estimateEventCost({
      model: step.model,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      cachedReadTokens: step.cachedReadTokens,
      cacheWriteTokens: cacheWrite,
      reasoningTokens: reasoning,
    });

    return {
      id: `${workflowId}:step:${i}`,
      source: 'simulator',
      isSimulated: true,
      workflowId,
      workflowName: `${scenario.name} (#${runId})`,
      agentId: `${workflowId}:${step.agentKey}`,
      agentName: step.agentName,
      agentRole: step.agentRole,
      parentAgentId: step.parentAgentKey ? `${workflowId}:${step.parentAgentKey}` : null,
      kind: step.kind,
      operation: step.operation,
      toolName: step.toolName ?? null,
      provider: cost.provider,
      model: step.model,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      cachedReadTokens: step.cachedReadTokens,
      cacheWriteTokens: cacheWrite,
      reasoningTokens: reasoning,
      totalTokens,
      estimatedCostUsd: cost.estimatedCostUsd,
      cacheSavingsUsd: cost.cacheSavingsUsd,
      copilotPremiumRequests: cost.copilotPremiumRequests,
      costSource: cost.costSource,
      startTimeMs,
      endTimeMs,
      durationMs: step.durationMs,
      ttftMs: Math.round(step.durationMs * 0.22),
      status: step.status ?? 'ok',
      errorMessage: step.errorMessage ?? null,
      project: scenario.project,
    };
  });
}

export function streamSimulatedWorkflow(
  store: TelemetryStore,
  options?: { instant?: boolean; scenarioIndex?: number },
): { workflowId: string; eventCount: number } {
  const events = buildSimulatedWorkflowEvents(options?.scenarioIndex);
  if (options?.instant) {
    store.upsert(events);
    return { workflowId: events[0].workflowId, eventCount: events.length };
  }

  // Stream events progressively over ~2.8s so the user sees live SSE updates in the UI!
  events.forEach((ev, idx) => {
    const delay = idx * 280;
    setTimeout(() => {
      store.upsert([ev]);
    }, delay);
  });

  return { workflowId: events[0].workflowId, eventCount: events.length };
}
