import { describe, expect, it } from 'vitest';
import { UsageDb } from '../src/storage/db.js';
import type { ChatEvent, ToolCallEvent } from '../src/model/events.js';

function chatEvent(overrides: Partial<ChatEvent>): ChatEvent {
  return {
    kind: 'chat',
    conversationId: 'trace-1',
    spanId: 'span-1',
    timestampMs: 1700000000000,
    provider: 'github',
    requestedModel: 'gpt-4o',
    resolvedModel: 'gpt-4o-2024-08-06',
    agentName: 'copilot',
    chatSessionId: 'chat-session-1',
    turnIndex: 0,
    inputTokens: 100,
    outputTokens: 200,
    cachedTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    timeToFirstTokenMs: 500,
    realCreditsUsd: null,
    ...overrides
  };
}

function toolCallEvent(overrides: Partial<ToolCallEvent>): ToolCallEvent {
  return {
    kind: 'tool_call',
    conversationId: 'trace-1',
    spanId: 'tool-1',
    timestampMs: 1700000000500,
    agentName: 'copilot',
    chatSessionId: 'chat-session-1',
    turnIndex: 0,
    toolName: 'readFile',
    toolType: 'function',
    toolCallId: 'call-1',
    errorType: null,
    durationMs: 42,
    ...overrides
  };
}

describe('UsageDb', () => {
  it('aggregates chat events by model, including premium-request estimates', async () => {
    const db = await UsageDb.create();
    db.insertChatEvent(chatEvent({ spanId: 'span-1', resolvedModel: 'gpt-4o-2024-08-06' }));
    db.insertChatEvent(chatEvent({ spanId: 'span-2', resolvedModel: 'claude-sonnet-4-6-20260201' }));
    db.insertChatEvent(chatEvent({ spanId: 'span-3', resolvedModel: 'claude-sonnet-4-6-20260201' }));

    const byModel = db.aggregateByModel();
    const gpt4o = byModel.find((m) => m.model === 'gpt-4o-2024-08-06');
    const sonnet = byModel.find((m) => m.model === 'claude-sonnet-4-6-20260201');

    expect(gpt4o?.requestCount).toBe(1);
    expect(gpt4o?.totalPremiumRequestUnits).toBe(0);
    expect(sonnet?.requestCount).toBe(2);
    expect(sonnet?.totalPremiumRequestUnits).toBe(18); // 2 requests x 9 multiplier
    expect(sonnet?.totalInputTokens).toBe(200);

    db.close();
  });

  it('aggregates by agent across chat and tool-call events, including tool error counts', async () => {
    const db = await UsageDb.create();
    db.insertChatEvent(chatEvent({ spanId: 'span-1', agentName: 'Explore' }));
    db.insertToolCallEvent(toolCallEvent({ spanId: 'tool-1', agentName: 'Explore', errorType: null }));
    db.insertToolCallEvent(toolCallEvent({ spanId: 'tool-2', agentName: 'Explore', errorType: 'TimeoutError' }));

    const byAgent = db.aggregateByAgent();
    const explore = byAgent.find((a) => a.agentName === 'Explore');

    expect(explore?.chatRequestCount).toBe(1);
    expect(explore?.toolCallCount).toBe(2);
    expect(explore?.toolErrorCount).toBe(1);

    db.close();
  });

  it('is idempotent on re-insert of the same span id (INSERT OR REPLACE, not double count)', async () => {
    const db = await UsageDb.create();
    db.insertChatEvent(chatEvent({ spanId: 'span-1' }));
    db.insertChatEvent(chatEvent({ spanId: 'span-1' }));

    const byModel = db.aggregateByModel();
    expect(byModel.reduce((sum, m) => sum + m.requestCount, 0)).toBe(1);

    db.close();
  });
});
