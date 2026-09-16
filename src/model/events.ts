export interface ChatEvent {
  kind: 'chat';
  conversationId: string;
  spanId: string;
  timestampMs: number;
  provider: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  agentName: string | null;
  chatSessionId: string | null;
  turnIndex: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Present when read from agent-traces.db; not part of the documented OTel span schema. */
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  timeToFirstTokenMs: number | null;
  /**
   * Real GitHub-reported credit consumption for this span, derived from the
   * `copilot_chat.copilot_usage_nano_aiu` span attribute (nano AIU ÷ 1e9) when present.
   * When this is available it should be preferred over any estimated cost — see
   * src/pricing/estimateCost.ts.
   */
  realCreditsUsd: number | null;
}

export interface ToolCallEvent {
  kind: 'tool_call';
  conversationId: string;
  spanId: string;
  timestampMs: number;
  agentName: string | null;
  chatSessionId: string | null;
  turnIndex: number | null;
  toolName: string | null;
  toolType: string | null;
  toolCallId: string | null;
  errorType: string | null;
  durationMs: number | null;
}

export type NormalizedEvent = ChatEvent | ToolCallEvent;

export interface IngestWarning {
  lineNumber: number;
  reason: string;
}

export interface NormalizeResult {
  event: NormalizedEvent | null;
  warning: string | null;
}
