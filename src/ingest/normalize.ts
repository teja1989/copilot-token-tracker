import type { NormalizeResult } from '../model/events.js';
import { getNumberAttr, getStringAttr, type AttributeBag } from './attributes.js';

/**
 * Raw span shape is intentionally loose (`unknown`-ish) because the exact JSON produced
 * by Copilot Chat's `file` OTel exporter hasn't been validated against a real captured
 * fixture yet (see PLAN.md Phase 0/1). We accept a handful of plausible field name
 * variants for the envelope (span id, timestamp) and delegate attribute reads to
 * `attributes.ts`, which already tolerates both flattened and OTLP-array attribute
 * encodings. Anything we can't confidently read produces a warning and a null field
 * rather than a guessed value.
 */
export interface RawSpan {
  name?: unknown;
  spanId?: unknown;
  id?: unknown;
  traceId?: unknown;
  attributes?: unknown;
  startTimeUnixNano?: unknown;
  startTime?: unknown;
  timestamp?: unknown;
  endTimeUnixNano?: unknown;
  endTime?: unknown;
  status?: unknown;
}

const CHAT_OPERATION = 'chat';
const TOOL_OPERATION = 'execute_tool';

function toTimestampMs(span: RawSpan): number | null {
  if (typeof span.startTimeUnixNano === 'number') return Math.round(span.startTimeUnixNano / 1e6);
  if (typeof span.startTimeUnixNano === 'string' && /^\d+$/.test(span.startTimeUnixNano)) {
    return Math.round(Number(span.startTimeUnixNano) / 1e6);
  }
  if (typeof span.startTime === 'number') return span.startTime;
  if (typeof span.timestamp === 'number') return span.timestamp;
  if (typeof span.startTime === 'string') {
    const parsed = Date.parse(span.startTime);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof span.timestamp === 'string') {
    const parsed = Date.parse(span.timestamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function spanIdOf(span: RawSpan): string | null {
  if (typeof span.spanId === 'string') return span.spanId;
  if (typeof span.id === 'string') return span.id;
  return null;
}

function durationMsOf(span: RawSpan): number | null {
  const start = toTimestampMs(span);
  if (start == null) return null;
  let end: number | null = null;
  if (typeof span.endTimeUnixNano === 'number') end = Math.round(span.endTimeUnixNano / 1e6);
  else if (typeof span.endTimeUnixNano === 'string' && /^\d+$/.test(span.endTimeUnixNano)) {
    end = Math.round(Number(span.endTimeUnixNano) / 1e6);
  } else if (typeof span.endTime === 'number') end = span.endTime;
  else if (typeof span.endTime === 'string') {
    const parsed = Date.parse(span.endTime);
    if (!Number.isNaN(parsed)) end = parsed;
  }
  if (end == null) return null;
  const delta = end - start;
  return delta >= 0 ? delta : null;
}

export function normalizeSpan(raw: unknown): NormalizeResult {
  if (raw == null || typeof raw !== 'object') {
    return { event: null, warning: 'span is not an object' };
  }
  const span = raw as RawSpan;
  const attrs = span.attributes as AttributeBag;

  const operation = getStringAttr(attrs, 'gen_ai.operation.name');
  const spanId = spanIdOf(span);
  const timestampMs = toTimestampMs(span);
  const conversationId = getStringAttr(attrs, 'gen_ai.conversation.id') ?? (typeof span.traceId === 'string' ? span.traceId : null);

  if (spanId == null || timestampMs == null || conversationId == null) {
    return {
      event: null,
      warning: `span missing required envelope field(s): ${[
        spanId == null ? 'spanId' : null,
        timestampMs == null ? 'timestamp' : null,
        conversationId == null ? 'conversationId' : null
      ]
        .filter(Boolean)
        .join(', ')}`
    };
  }

  if (operation === CHAT_OPERATION) {
    return {
      event: {
        kind: 'chat',
        conversationId,
        spanId,
        timestampMs,
        provider: getStringAttr(attrs, 'gen_ai.provider.name'),
        requestedModel: getStringAttr(attrs, 'gen_ai.request.model'),
        resolvedModel: getStringAttr(attrs, 'gen_ai.response.model'),
        agentName: getStringAttr(attrs, 'gen_ai.agent.name'),
        // Not part of the documented OTel gen_ai.* attribute set (confirmed only in the
        // agent-traces.db column schema — see src/ingest/tracesDb.ts). Left null here
        // rather than guessed-at attribute keys; populated when reading from the DB.
        chatSessionId: null,
        turnIndex: null,
        inputTokens: getNumberAttr(attrs, 'gen_ai.usage.input_tokens'),
        outputTokens: getNumberAttr(attrs, 'gen_ai.usage.output_tokens'),
        cachedTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
        // Documented as seconds; normalize to ms for consistency with everything else.
        timeToFirstTokenMs: (() => {
          const seconds = getNumberAttr(attrs, 'copilot_chat.time_to_first_token');
          return seconds == null ? null : Math.round(seconds * 1000);
        })(),
        realCreditsUsd: null
      },
      warning: null
    };
  }

  if (operation === TOOL_OPERATION) {
    return {
      event: {
        kind: 'tool_call',
        conversationId,
        spanId,
        timestampMs,
        agentName: getStringAttr(attrs, 'gen_ai.agent.name'),
        chatSessionId: null,
        turnIndex: null,
        toolName: getStringAttr(attrs, 'gen_ai.tool.name'),
        toolType: getStringAttr(attrs, 'gen_ai.tool.type'),
        toolCallId: getStringAttr(attrs, 'gen_ai.tool.call.id'),
        errorType: getStringAttr(attrs, 'error.type'),
        durationMs: durationMsOf(span)
      },
      warning: null
    };
  }

  return { event: null, warning: `unrecognized gen_ai.operation.name: ${operation ?? '(missing)'}` };
}
