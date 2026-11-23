import { randomUUID } from 'node:crypto';
import type { SpanKind, SpanStatus, TelemetryEvent } from '../model/types.js';
import { estimateEventCost } from '../pricing/estimator.js';

interface OtlpAttrValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpAttribute {
  key: string;
  value?: OtlpAttrValue;
}

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: OtlpAttribute[];
  status?: { code?: number; message?: string };
}

interface OtlpPayload {
  resourceSpans?: Array<{
    resource?: { attributes?: OtlpAttribute[] };
    scopeSpans?: Array<{ spans?: OtlpSpan[] }>;
  }>;
}

function attrMap(attrs?: OtlpAttribute[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!Array.isArray(attrs)) return out;
  for (const a of attrs) {
    const v = a.value;
    if (!v) continue;
    if (v.stringValue !== undefined) out[a.key] = v.stringValue;
    else if (v.intValue !== undefined) out[a.key] = Number(v.intValue);
    else if (v.doubleValue !== undefined) out[a.key] = v.doubleValue;
    else if (v.boolValue !== undefined) out[a.key] = v.boolValue;
  }
  return out;
}

function numAttr(m: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = m[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

function strAttr(m: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = m[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function nanoToMs(v?: string | number): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v > 1e15 ? Math.round(v / 1e6) : v;
  }
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1e15 ? Math.round(n / 1e6) : n;
  }
  return Date.now();
}

/**
 * Parses OpenTelemetry OTLP/JSON ExportTraceServiceRequest payloads supporting
 * GenAI semantic conventions (gen_ai.*) and OpenInference (llm.*) attributes.
 */
export function parseOtlpTraces(payload: OtlpPayload): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  if (!Array.isArray(payload?.resourceSpans)) return events;

  for (const rs of payload.resourceSpans) {
    const resAttrs = attrMap(rs.resource?.attributes);
    const serviceName = strAttr(resAttrs, 'service.name') ?? 'custom-agent';

    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const a = { ...resAttrs, ...attrMap(span.attributes) };
        const traceId = span.traceId || randomUUID();
        const spanId = span.spanId || randomUUID();

        const model =
          strAttr(a, 'gen_ai.response.model', 'gen_ai.request.model', 'llm.model_name', 'model') ??
          'unknown-model';
        const provider = strAttr(a, 'gen_ai.system', 'gen_ai.provider.name', 'llm.provider');

        const inputTokens = numAttr(a, 'gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens', 'llm.token_count.prompt');
        const outputTokens = numAttr(a, 'gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens', 'llm.token_count.completion');
        const cachedReadTokens = numAttr(a, 'gen_ai.usage.cache_read.input_tokens', 'gen_ai.usage.cached_tokens');
        const cacheWriteTokens = numAttr(a, 'gen_ai.usage.cache_creation.input_tokens');
        const reasoningTokens = numAttr(a, 'gen_ai.usage.reasoning_tokens');
        const totalTokens = inputTokens + outputTokens + cachedReadTokens + cacheWriteTokens + reasoningTokens;

        const agentName = strAttr(a, 'gen_ai.agent.name', 'agent.name', 'service.name') ?? serviceName;
        const agentRole = strAttr(a, 'gen_ai.agent.role', 'agent.role') ?? 'Agent';
        const workflowId = strAttr(a, 'workflow.id', 'session.id') ?? `otlp:${traceId}`;
        const workflowName = strAttr(a, 'workflow.name') ?? `${serviceName} · ${traceId.slice(0, 8)}`;
        const toolName = strAttr(a, 'gen_ai.tool.name', 'tool.name');
        const parentAgentName = strAttr(a, 'gen_ai.agent.parent', 'agent.parent');

        const startTimeMs = nanoToMs(span.startTimeUnixNano);
        const endTimeMs = Math.max(startTimeMs, nanoToMs(span.endTimeUnixNano));
        const durationMs = endTimeMs - startTimeMs;

        const reportedCost = numAttr(a, 'gen_ai.usage.cost_usd', 'llm.cost_usd');
        const cost = estimateEventCost({
          model,
          provider,
          inputTokens,
          outputTokens,
          cachedReadTokens,
          cacheWriteTokens,
          reasoningTokens,
          reportedCostUsd: reportedCost > 0 ? reportedCost : null,
        });

        const isError = span.status?.code === 2;
        events.push({
          id: `otlp:${spanId}`,
          source: 'otlp',
          isSimulated: false,
          workflowId,
          workflowName,
          agentId: `${workflowId}:${agentName}`,
          agentName,
          agentRole,
          parentSpanId: span.parentSpanId ? `otlp:${span.parentSpanId}` : null,
          parentAgentId: parentAgentName ? `${workflowId}:${parentAgentName}` : null,
          kind: toolName ? 'tool' : 'llm',
          operation: span.name || (toolName ? `tool:${toolName}` : 'gen_ai.chat'),
          toolName,
          provider: cost.provider,
          model,
          inputTokens,
          outputTokens,
          cachedReadTokens,
          cacheWriteTokens,
          reasoningTokens,
          totalTokens,
          estimatedCostUsd: cost.estimatedCostUsd,
          cacheSavingsUsd: cost.cacheSavingsUsd,
          costSource: cost.costSource,
          startTimeMs,
          endTimeMs,
          durationMs,
          status: isError ? 'error' : 'ok',
          errorMessage: isError ? span.status?.message ?? 'Span error' : null,
          project: serviceName,
        });
      }
    }
  }

  return events;
}

export interface SimpleIngestEvent {
  id?: string;
  workflowId?: string;
  workflowName?: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;
  parentAgentId?: string | null;
  parentSpanId?: string | null;
  kind?: SpanKind;
  operation?: string;
  toolName?: string | null;
  provider?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  startTimeMs?: number;
  endTimeMs?: number;
  durationMs?: number;
  ttftMs?: number;
  status?: SpanStatus;
  errorMessage?: string;
  project?: string;
}

export function normalizeSimpleIngest(input: SimpleIngestEvent | SimpleIngestEvent[]): TelemetryEvent[] {
  const items = Array.isArray(input) ? input : [input];
  const now = Date.now();

  return items.map((item) => {
    const workflowId = item.workflowId?.trim() || `sdk:${randomUUID().slice(0, 8)}`;
    const agentName = item.agentName?.trim() || 'Custom Agent';
    const agentId = item.agentId?.trim() || `${workflowId}:${agentName}`;

    const inputTokens = Math.max(0, Number(item.inputTokens ?? 0) || 0);
    const outputTokens = Math.max(0, Number(item.outputTokens ?? 0) || 0);
    const cachedReadTokens = Math.max(0, Number(item.cachedReadTokens ?? 0) || 0);
    const cacheWriteTokens = Math.max(0, Number(item.cacheWriteTokens ?? 0) || 0);
    const reasoningTokens = Math.max(0, Number(item.reasoningTokens ?? 0) || 0);
    const totalTokens = inputTokens + outputTokens + cachedReadTokens + cacheWriteTokens + reasoningTokens;

    const durationMs = Math.max(0, item.durationMs ?? (item.endTimeMs && item.startTimeMs ? item.endTimeMs - item.startTimeMs : 800));
    const endTimeMs = item.endTimeMs ?? now;
    const startTimeMs = item.startTimeMs ?? endTimeMs - durationMs;

    const cost = estimateEventCost({
      model: item.model || 'unknown',
      provider: item.provider,
      inputTokens,
      outputTokens,
      cachedReadTokens,
      cacheWriteTokens,
      reasoningTokens,
      reportedCostUsd: typeof item.costUsd === 'number' ? item.costUsd : null,
    });

    return {
      id: item.id?.trim() || `sdk:${randomUUID()}`,
      source: 'sdk',
      isSimulated: false,
      workflowId,
      workflowName: item.workflowName?.trim() || `SDK Workflow · ${workflowId.slice(0, 12)}`,
      agentId,
      agentName,
      agentRole: item.agentRole?.trim() || 'Agent',
      parentSpanId: item.parentSpanId ?? null,
      parentAgentId: item.parentAgentId ?? null,
      kind: item.kind ?? (item.toolName ? 'tool' : 'llm'),
      operation: item.operation?.trim() || (item.toolName ? `tool:${item.toolName}` : 'llm.call'),
      toolName: item.toolName ?? null,
      provider: cost.provider,
      model: item.model || 'unknown',
      inputTokens,
      outputTokens,
      cachedReadTokens,
      cacheWriteTokens,
      reasoningTokens,
      totalTokens,
      estimatedCostUsd: cost.estimatedCostUsd,
      cacheSavingsUsd: cost.cacheSavingsUsd,
      costSource: cost.costSource,
      startTimeMs,
      endTimeMs,
      durationMs,
      ttftMs: item.ttftMs ?? null,
      status: item.status ?? 'ok',
      errorMessage: item.errorMessage ?? null,
      project: item.project ?? 'Custom SDK',
    };
  });
}
