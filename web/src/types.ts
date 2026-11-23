export type SourceKind =
  | 'copilot'
  | 'claude-code'
  | 'antigravity'
  | 'codex'
  | 'otlp'
  | 'sdk'
  | 'simulator';

export type SpanKind = 'llm' | 'agent' | 'tool' | 'handoff';
export type SpanStatus = 'ok' | 'error' | 'running';

export interface TelemetryEvent {
  id: string;
  source: SourceKind;
  isSimulated?: boolean;
  workflowId: string;
  workflowName: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  parentSpanId?: string | null;
  parentAgentId?: string | null;
  kind: SpanKind;
  operation: string;
  toolName?: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  cacheSavingsUsd: number;
  copilotPremiumRequests?: number;
  costSource: 'provider-reported' | 'catalog-estimate' | 'unknown';
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  ttftMs?: number | null;
  status: SpanStatus;
  errorMessage?: string | null;
  project?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AgentNodeSummary {
  agentId: string;
  agentName: string;
  agentRole: string;
  source: SourceKind;
  models: string[];
  calls: number;
  toolCalls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  cacheSavingsUsd: number;
  avgLatencyMs: number;
  firstSeenMs: number;
  lastSeenMs: number;
  activeMs: number;
  depth: number;
  status: SpanStatus;
}

export interface AgentEdgeSummary {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  handoffCount: number;
  tokensTransferred: number;
  costTransferredUsd: number;
  avgLatencyMs: number;
  operations: string[];
}

export interface WorkflowRunSummary {
  workflowId: string;
  workflowName: string;
  source: SourceKind;
  isSimulated: boolean;
  project: string | null;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  agentCount: number;
  spanCount: number;
  errorCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  estimatedCostUsd: number;
  cacheSavingsUsd: number;
  cacheHitRate: number;
  models: string[];
  status: SpanStatus;
}

export interface CollaborationMetrics {
  parallelismFactor: number;
  maxDelegationDepth: number;
  totalHandoffs: number;
  toolSuccessRate: number;
  retryCount: number;
  coordinatorTokenShare: number;
  totalActiveAgentMs: number;
}

export interface WorkflowGraphDetail {
  workflow: WorkflowRunSummary;
  collaboration: CollaborationMetrics;
  nodes: AgentNodeSummary[];
  edges: AgentEdgeSummary[];
  criticalPathAgentIds: string[];
  spans: TelemetryEvent[];
}

export interface TimeSeriesBucket {
  timestampMs: number;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  requests: number;
  errors: number;
}

export interface ModelUsageSummary {
  model: string;
  provider: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  cacheSavingsUsd: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
}

export interface SourceUsageSummary {
  source: SourceKind;
  requests: number;
  workflows: number;
  agents: number;
  totalTokens: number;
  estimatedCostUsd: number;
  lastSeenMs: number;
}

export interface ProjectUsageSummary {
  project: string;
  workflows: number;
  requests: number;
  agents: number;
  totalTokens: number;
  cachedReadTokens: number;
  cacheHitRate: number;
  estimatedCostUsd: number;
  lastSeenMs: number;
}

export interface EfficiencyInsight {
  id: string;
  severity: 'high' | 'medium' | 'low' | 'positive';
  category: 'cost' | 'caching' | 'orchestration' | 'reliability' | 'latency';
  title: string;
  description: string;
  recommendation: string;
  estimatedMonthlySavingsUsd?: number;
  affectedModels?: string[];
  affectedAgents?: string[];
}

export interface DiscoveredSourceStatus {
  source: SourceKind;
  label: string;
  detected: boolean;
  paths: string[];
  eventsIngested: number;
  lastScannedMs: number | null;
  lastError?: string | null;
}

export interface DashboardMetrics {
  generatedAtMs: number;
  kpis: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    totalCostUsd: number;
    cacheSavingsUsd: number;
    cacheHitRate: number;
    totalRequests: number;
    totalWorkflows: number;
    uniqueAgents: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    errorRate: number;
    efficiencyScore: number;
  };
  timeSeries: TimeSeriesBucket[];
  byModel: ModelUsageSummary[];
  bySource: SourceUsageSummary[];
  byProject: ProjectUsageSummary[];
  topTools: Array<{ toolName: string; calls: number; errors: number; avgDurationMs: number; totalTokens: number }>;
  insights: EfficiencyInsight[];
  sources: DiscoveredSourceStatus[];
}
