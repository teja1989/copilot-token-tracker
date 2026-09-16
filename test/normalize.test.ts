import { describe, expect, it } from 'vitest';
import { normalizeSpan } from '../src/ingest/normalize.js';

describe('normalizeSpan', () => {
  it('normalizes a chat span with flat attributes', () => {
    const { event, warning } = normalizeSpan({
      name: 'chat',
      spanId: 'span-1',
      startTimeUnixNano: 1700000000000000000,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'github',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.response.model': 'gpt-4o-2024-08-06',
        'gen_ai.agent.name': 'copilot',
        'gen_ai.usage.input_tokens': 120,
        'gen_ai.usage.output_tokens': 340,
        'copilot_chat.time_to_first_token': 0.82,
        'gen_ai.conversation.id': 'trace-abc'
      }
    });
    expect(warning).toBeNull();
    expect(event).toEqual({
      kind: 'chat',
      conversationId: 'trace-abc',
      spanId: 'span-1',
      timestampMs: 1700000000000,
      provider: 'github',
      requestedModel: 'gpt-4o',
      resolvedModel: 'gpt-4o-2024-08-06',
      agentName: 'copilot',
      inputTokens: 120,
      outputTokens: 340,
      timeToFirstTokenMs: 820
    });
  });

  it('normalizes a chat span with OTLP array-of-kv attributes', () => {
    const { event, warning } = normalizeSpan({
      name: 'chat',
      spanId: 'span-2',
      startTime: 1700000100000,
      attributes: [
        { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
        { key: 'gen_ai.request.model', value: { stringValue: 'claude-sonnet-4.6' } },
        { key: 'gen_ai.response.model', value: { stringValue: 'claude-sonnet-4-6-20260201' } },
        { key: 'gen_ai.agent.name', value: { stringValue: 'Explore' } },
        { key: 'gen_ai.usage.input_tokens', value: { intValue: 900 } },
        { key: 'gen_ai.usage.output_tokens', value: { intValue: 410 } },
        { key: 'gen_ai.conversation.id', value: { stringValue: 'trace-xyz' } }
      ]
    });
    expect(warning).toBeNull();
    expect(event?.kind).toBe('chat');
    if (event?.kind === 'chat') {
      expect(event.agentName).toBe('Explore');
      expect(event.inputTokens).toBe(900);
      expect(event.outputTokens).toBe(410);
      expect(event.resolvedModel).toBe('claude-sonnet-4-6-20260201');
    }
  });

  it('normalizes a tool-call span including error and duration', () => {
    const { event, warning } = normalizeSpan({
      name: 'execute_tool',
      spanId: 'span-3',
      startTime: 1700000200000,
      endTime: 1700000201500,
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.agent.name': 'copilot',
        'gen_ai.tool.name': 'readFile',
        'gen_ai.tool.type': 'function',
        'gen_ai.tool.call.id': 'call-1',
        'error.type': 'FileNotFoundError',
        'gen_ai.conversation.id': 'trace-xyz'
      }
    });
    expect(warning).toBeNull();
    expect(event).toEqual({
      kind: 'tool_call',
      conversationId: 'trace-xyz',
      spanId: 'span-3',
      timestampMs: 1700000200000,
      agentName: 'copilot',
      toolName: 'readFile',
      toolType: 'function',
      toolCallId: 'call-1',
      errorType: 'FileNotFoundError',
      durationMs: 1500
    });
  });

  it('fails safe (no event, warning set) when required envelope fields are missing', () => {
    const { event, warning } = normalizeSpan({
      name: 'chat',
      attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'gpt-4o' }
    });
    expect(event).toBeNull();
    expect(warning).toContain('spanId');
  });

  it('fails safe on an unrecognized operation name instead of guessing', () => {
    const { event, warning } = normalizeSpan({
      name: 'unknown_op',
      spanId: 'span-5',
      startTime: 1700000300000,
      attributes: { 'gen_ai.operation.name': 'embeddings', 'gen_ai.conversation.id': 'trace-xyz' }
    });
    expect(event).toBeNull();
    expect(warning).toContain('embeddings');
  });

  it('fails safe on completely malformed input', () => {
    const { event, warning } = normalizeSpan('not an object');
    expect(event).toBeNull();
    expect(warning).not.toBeNull();
  });
});
