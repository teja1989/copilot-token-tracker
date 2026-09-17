import { describe, expect, it } from 'vitest';
import { chatEventToExportDocument, toolCallEventToExportDocument } from '../src/export/toExportDocument.js';
import type { StoredChatEvent, StoredToolCallEvent } from '../src/storage/db.js';

const envelope = { orgId: 'acme-corp', userId: 'u_deadbeefcafebabe', installationId: 'ext-1234', extensionVersion: '0.1.0' };

function chatRow(overrides: Partial<StoredChatEvent> = {}): StoredChatEvent {
  return {
    spanId: 'sp_1',
    conversationId: 'c_1',
    chatSessionId: 'c_1',
    turnIndex: 0,
    timestampMs: 1000,
    provider: 'github',
    requestedModel: 'gpt-4o',
    resolvedModel: 'gpt-4o-2024-08-06',
    agentName: 'Explore',
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 10,
    cacheWriteTokens: null,
    reasoningTokens: 0,
    timeToFirstTokenMs: 200,
    usdCost: 0.01,
    premiumRequestUnits: 0,
    costSource: 'real',
    ...overrides
  };
}

describe('chatEventToExportDocument', () => {
  it('maps every field and uses spanId as _id', () => {
    const doc = chatEventToExportDocument(chatRow(), envelope);
    expect(doc['_id']).toBe('sp_1');
    expect(doc['kind']).toBe('chat');
    expect(doc['orgId']).toBe('acme-corp');
    expect(doc['userId']).toBe('u_deadbeefcafebabe');
    expect(doc['resolvedModel']).toBe('gpt-4o-2024-08-06');
    expect(doc['usdCost']).toBe(0.01);
  });

  it('derives realCreditsUsd from usdCost only when costSource is real', () => {
    const real = chatEventToExportDocument(chatRow({ costSource: 'real', usdCost: 0.02 }), envelope);
    expect(real['realCreditsUsd']).toBe(0.02);

    const estimated = chatEventToExportDocument(chatRow({ costSource: 'estimated_token_rate', usdCost: 0.02 }), envelope);
    expect(estimated['realCreditsUsd']).toBeNull();
    expect(estimated['usdCost']).toBe(0.02); // the estimate itself is still carried, just not mislabeled as real
  });

  it('passes a null userId through unchanged (fully-anonymous identity option)', () => {
    const doc = chatEventToExportDocument(chatRow(), { ...envelope, userId: null });
    expect(doc['userId']).toBeNull();
  });
});

describe('toolCallEventToExportDocument', () => {
  it('maps every field and uses spanId as _id', () => {
    const row: StoredToolCallEvent = {
      spanId: 'sp_2',
      conversationId: 'c_1',
      chatSessionId: 'c_1',
      turnIndex: 0,
      timestampMs: 1500,
      agentName: 'Explore',
      toolName: 'grep',
      toolType: 'function',
      toolCallId: 'call_1',
      errorType: null,
      durationMs: 40
    };
    const doc = toolCallEventToExportDocument(row, envelope);
    expect(doc['_id']).toBe('sp_2');
    expect(doc['kind']).toBe('tool_call');
    expect(doc['toolName']).toBe('grep');
    expect(doc['installationId']).toBe('ext-1234');
  });
});
