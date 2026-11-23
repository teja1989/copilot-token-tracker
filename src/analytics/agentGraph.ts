import type {
  AgentEdgeSummary,
  AgentNodeSummary,
  SpanStatus,
  TelemetryEvent,
  WorkflowGraphDetail,
  WorkflowRunSummary,
} from '../model/types.js';

export function buildWorkflowSummaries(events: TelemetryEvent[]): WorkflowRunSummary[] {
  const byWorkflow = new Map<string, TelemetryEvent[]>();
  for (const ev of events) {
    const list = byWorkflow.get(ev.workflowId);
    if (list) list.push(ev);
    else byWorkflow.set(ev.workflowId, [ev]);
  }

  const summaries: WorkflowRunSummary[] = [];

  for (const [workflowId, list] of byWorkflow.entries()) {
    list.sort((a, b) => a.startTimeMs - b.startTimeMs);
    const first = list[0];
    let startTimeMs = first.startTimeMs;
    let endTimeMs = first.endTimeMs;
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedReadTokens = 0;
    let estimatedCostUsd = 0;
    let cacheSavingsUsd = 0;
    let errorCount = 0;
    let hasRunning = false;

    const agents = new Set<string>();
    const models = new Set<string>();

    for (const ev of list) {
      if (ev.startTimeMs < startTimeMs) startTimeMs = ev.startTimeMs;
      if (ev.endTimeMs > endTimeMs) endTimeMs = ev.endTimeMs;
      totalTokens += ev.totalTokens;
      inputTokens += ev.inputTokens;
      outputTokens += ev.outputTokens;
      cachedReadTokens += ev.cachedReadTokens;
      estimatedCostUsd += ev.estimatedCostUsd;
      cacheSavingsUsd += ev.cacheSavingsUsd;
      if (ev.status === 'error') errorCount++;
      if (ev.status === 'running') hasRunning = true;
      agents.add(ev.agentId);
      if (ev.model && ev.model !== 'unknown') models.add(ev.model);
    }

    const totalPromptSide = inputTokens + cachedReadTokens;
    const cacheHitRate = totalPromptSide > 0 ? cachedReadTokens / totalPromptSide : 0;

    let status: SpanStatus = 'ok';
    if (hasRunning) status = 'running';
    else if (errorCount > 0 && errorCount === list.length) status = 'error';

    summaries.push({
      workflowId,
      workflowName: first.workflowName,
      source: first.source,
      isSimulated: Boolean(first.isSimulated),
      project: first.project ?? null,
      startTimeMs,
      endTimeMs,
      durationMs: Math.max(0, endTimeMs - startTimeMs),
      agentCount: agents.size,
      spanCount: list.length,
      errorCount,
      totalTokens,
      inputTokens,
      outputTokens,
      cachedReadTokens,
      estimatedCostUsd: roundUsd(estimatedCostUsd),
      cacheSavingsUsd: roundUsd(cacheSavingsUsd),
      cacheHitRate,
      models: Array.from(models),
      status,
    });
  }

  summaries.sort((a, b) => b.endTimeMs - a.endTimeMs);
  return summaries;
}

export function buildWorkflowGraph(events: TelemetryEvent[], workflowId: string): WorkflowGraphDetail | null {
  const spans = events
    .filter((e) => e.workflowId === workflowId)
    .sort((a, b) => a.startTimeMs - b.startTimeMs);

  if (spans.length === 0) return null;

  const summary = buildWorkflowSummaries(spans)[0];
  const spanById = new Map<string, TelemetryEvent>();
  for (const s of spans) spanById.set(s.id, s);

  // Build agent nodes
  const nodeMap = new Map<
    string,
    AgentNodeSummary & { modelSet: Set<string>; latencySum: number }
  >();

  for (const s of spans) {
    let node = nodeMap.get(s.agentId);
    if (!node) {
      node = {
        agentId: s.agentId,
        agentName: s.agentName,
        agentRole: s.agentRole,
        source: s.source,
        models: [],
        modelSet: new Set<string>(),
        calls: 0,
        toolCalls: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        cacheSavingsUsd: 0,
        avgLatencyMs: 0,
        latencySum: 0,
        firstSeenMs: s.startTimeMs,
        lastSeenMs: s.endTimeMs,
        activeMs: 0,
        depth: 0,
        status: 'ok',
      };
      nodeMap.set(s.agentId, node);
    }

    node.calls += 1;
    if (s.kind === 'tool' || s.toolName) node.toolCalls += 1;
    if (s.status === 'error') {
      node.errors += 1;
      node.status = 'error';
    } else if (s.status === 'running' && node.status !== 'error') {
      node.status = 'running';
    }
    if (s.model) node.modelSet.add(s.model);
    node.inputTokens += s.inputTokens;
    node.outputTokens += s.outputTokens;
    node.cachedReadTokens += s.cachedReadTokens;
    node.cacheWriteTokens += s.cacheWriteTokens;
    node.reasoningTokens += s.reasoningTokens;
    node.totalTokens += s.totalTokens;
    node.estimatedCostUsd += s.estimatedCostUsd;
    node.cacheSavingsUsd += s.cacheSavingsUsd;
    node.latencySum += s.durationMs;
    if (s.startTimeMs < node.firstSeenMs) node.firstSeenMs = s.startTimeMs;
    if (s.endTimeMs > node.lastSeenMs) node.lastSeenMs = s.endTimeMs;
  }

  // Build inter-agent handoff edges
  const edgeMap = new Map<
    string,
    AgentEdgeSummary & { opSet: Set<string>; latencySum: number }
  >();

  for (const s of spans) {
    let parentAgentId = s.parentAgentId ?? null;
    if (!parentAgentId && s.parentSpanId) {
      const parentSpan = spanById.get(s.parentSpanId);
      if (parentSpan && parentSpan.agentId !== s.agentId) {
        parentAgentId = parentSpan.agentId;
      }
    }
    if (!parentAgentId || parentAgentId === s.agentId || !nodeMap.has(parentAgentId)) {
      continue;
    }

    const edgeKey = `${parentAgentId}-->${s.agentId}`;
    let edge = edgeMap.get(edgeKey);
    if (!edge) {
      edge = {
        id: edgeKey,
        fromAgentId: parentAgentId,
        toAgentId: s.agentId,
        handoffCount: 0,
        tokensTransferred: 0,
        costTransferredUsd: 0,
        avgLatencyMs: 0,
        latencySum: 0,
        operations: [],
        opSet: new Set<string>(),
      };
      edgeMap.set(edgeKey, edge);
    }
    edge.handoffCount += 1;
    edge.tokensTransferred += s.totalTokens;
    edge.costTransferredUsd += s.estimatedCostUsd;
    edge.latencySum += s.durationMs;
    edge.opSet.add(s.operation);
  }

  // Compute topological depth via BFS from root agents (no incoming edges)
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const id of nodeMap.keys()) {
    incoming.set(id, new Set());
    outgoing.set(id, new Set());
  }
  for (const e of edgeMap.values()) {
    incoming.get(e.toAgentId)?.add(e.fromAgentId);
    outgoing.get(e.fromAgentId)?.add(e.toAgentId);
  }

  const roots = Array.from(nodeMap.keys()).filter((id) => (incoming.get(id)?.size ?? 0) === 0);
  if (roots.length === 0 && nodeMap.size > 0) {
    // Cycle fallback: earliest seen agent is root
    const earliest = Array.from(nodeMap.values()).sort((a, b) => a.firstSeenMs - b.firstSeenMs)[0];
    roots.push(earliest.agentId);
  }

  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = roots.map((id) => ({ id, depth: 0 }));
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr.id)) continue;
    visited.add(curr.id);
    const node = nodeMap.get(curr.id);
    if (node) node.depth = curr.depth;
    for (const nextId of outgoing.get(curr.id) ?? []) {
      if (!visited.has(nextId)) {
        queue.push({ id: nextId, depth: curr.depth + 1 });
      }
    }
  }

  const nodes: AgentNodeSummary[] = Array.from(nodeMap.values())
    .map((n) => ({
      agentId: n.agentId,
      agentName: n.agentName,
      agentRole: n.agentRole,
      source: n.source,
      models: Array.from(n.modelSet),
      calls: n.calls,
      toolCalls: n.toolCalls,
      errors: n.errors,
      inputTokens: n.inputTokens,
      outputTokens: n.outputTokens,
      cachedReadTokens: n.cachedReadTokens,
      cacheWriteTokens: n.cacheWriteTokens,
      reasoningTokens: n.reasoningTokens,
      totalTokens: n.totalTokens,
      estimatedCostUsd: roundUsd(n.estimatedCostUsd),
      cacheSavingsUsd: roundUsd(n.cacheSavingsUsd),
      avgLatencyMs: n.calls > 0 ? Math.round(n.latencySum / n.calls) : 0,
      firstSeenMs: n.firstSeenMs,
      lastSeenMs: n.lastSeenMs,
      activeMs: Math.max(0, n.lastSeenMs - n.firstSeenMs),
      depth: n.depth,
      status: n.status,
    }))
    .sort((a, b) => a.depth - b.depth || a.firstSeenMs - b.firstSeenMs);

  const edges: AgentEdgeSummary[] = Array.from(edgeMap.values()).map((e) => ({
    id: e.id,
    fromAgentId: e.fromAgentId,
    toAgentId: e.toAgentId,
    handoffCount: e.handoffCount,
    tokensTransferred: e.tokensTransferred,
    costTransferredUsd: roundUsd(e.costTransferredUsd),
    avgLatencyMs: e.handoffCount > 0 ? Math.round(e.latencySum / e.handoffCount) : 0,
    operations: Array.from(e.opSet),
  }));

  // Compute critical path (highest cumulative active duration path from root to leaf)
  const criticalPathAgentIds = computeCriticalPath(nodes, outgoing, roots);

  // Compute deeper multi-agent collaboration metrics
  const totalActiveAgentMs = nodes.reduce((sum, n) => sum + Math.max(n.activeMs, n.avgLatencyMs), 0);
  const wallMs = Math.max(1, summary.durationMs);
  const parallelismFactor = Math.round((totalActiveAgentMs / wallMs) * 100) / 100;
  const maxDelegationDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const totalHandoffs = edges.reduce((sum, e) => sum + e.handoffCount, 0);
  const toolSpans = spans.filter((s) => s.kind === 'tool' || Boolean(s.toolName));
  const toolErrors = toolSpans.filter((s) => s.status === 'error').length;
  const toolSuccessRate = toolSpans.length > 0 ? (toolSpans.length - toolErrors) / toolSpans.length : 1;
  const retryCount = spans.filter((s) => s.status === 'error').length;
  const rootTokens = nodes.filter((n) => n.depth === 0).reduce((s, n) => s + n.totalTokens, 0);
  const coordinatorTokenShare = summary.totalTokens > 0 ? rootTokens / summary.totalTokens : 1;

  return {
    workflow: summary,
    collaboration: {
      parallelismFactor,
      maxDelegationDepth,
      totalHandoffs,
      toolSuccessRate,
      retryCount,
      coordinatorTokenShare,
      totalActiveAgentMs,
    },
    nodes,
    edges,
    criticalPathAgentIds,
    spans,
  };
}

function computeCriticalPath(
  nodes: AgentNodeSummary[],
  outgoing: Map<string, Set<string>>,
  roots: string[],
): string[] {
  const byId = new Map(nodes.map((n) => [n.agentId, n]));
  const memo = new Map<string, { score: number; path: string[] }>();

  function dfs(id: string, stack: Set<string>): { score: number; path: string[] } {
    if (memo.has(id)) return memo.get(id)!;
    const node = byId.get(id);
    const weight = node ? Math.max(1, node.activeMs || node.avgLatencyMs) : 1;
    const nextStack = new Set(stack);
    nextStack.add(id);

    let bestChild: { score: number; path: string[] } = { score: 0, path: [] };
    for (const childId of outgoing.get(id) ?? []) {
      if (nextStack.has(childId)) continue;
      const res = dfs(childId, nextStack);
      if (res.score > bestChild.score) bestChild = res;
    }

    const result = { score: weight + bestChild.score, path: [id, ...bestChild.path] };
    memo.set(id, result);
    return result;
  }

  let best: { score: number; path: string[] } = { score: 0, path: [] };
  for (const r of roots) {
    const res = dfs(r, new Set());
    if (res.score > best.score) best = res;
  }
  return best.path;
}

function roundUsd(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}
