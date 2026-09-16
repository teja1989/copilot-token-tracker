export interface ChatEvent {
  kind: 'chat';
  conversationId: string;
  spanId: string;
  timestampMs: number;
  provider: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  agentName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  timeToFirstTokenMs: number | null;
}

export interface ToolCallEvent {
  kind: 'tool_call';
  conversationId: string;
  spanId: string;
  timestampMs: number;
  agentName: string | null;
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
