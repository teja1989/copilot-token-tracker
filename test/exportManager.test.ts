import { describe, expect, it, vi } from 'vitest';
import { UsageDb } from '../src/storage/db.js';
import { exportNewEvents } from '../src/export/exportManager.js';
import type { ExportSink } from '../src/export/sink.js';
import type { ChatEvent } from '../src/model/events.js';

const envelope = { orgId: 'acme-corp', userId: 'u_abc123', installationId: 'ext-1', extensionVersion: '0.1.0' };

function chatEvent(overrides: Partial<ChatEvent>): ChatEvent {
  return {
    kind: 'chat',
    conversationId: 'c1',
    spanId: 'sp_1',
    timestampMs: 1000,
    provider: 'github',
    requestedModel: 'gpt-4o',
    resolvedModel: 'gpt-4o-2024-08-06',
    agentName: 'Explore',
    chatSessionId: 'c1',
    turnIndex: 0,
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    timeToFirstTokenMs: null,
    realCreditsUsd: null,
    ...overrides
  };
}

describe('exportNewEvents', () => {
  it('does nothing and reports hadNothingNew when there is nothing unexported', async () => {
    const db = await UsageDb.create();
    const send = vi.fn();
    const sink: ExportSink = { send };

    const result = await exportNewEvents(db, sink, envelope);

    expect(result).toEqual({ exportedCount: 0, hadNothingNew: true });
    expect(send).not.toHaveBeenCalled();
    db.close();
  });

  it('exports unexported rows and advances the watermark to the newest sent timestamp', async () => {
    const db = await UsageDb.create();
    db.insertChatEvent(chatEvent({ spanId: 'sp_1', timestampMs: 1000 }));
    db.insertChatEvent(chatEvent({ spanId: 'sp_2', timestampMs: 2000 }));
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await exportNewEvents(db, { send }, envelope);

    expect(result).toEqual({ exportedCount: 2, hadNothingNew: false });
    expect(send).toHaveBeenCalledTimes(1);
    const sentDocs = send.mock.calls[0]?.[0] as Array<{ _id: string }>;
    expect(sentDocs.map((d) => d._id)).toEqual(['sp_1', 'sp_2']);
    expect(db.getExportWatermarkMs()).toBe(2000);

    db.close();
  });

  it('only exports rows newer than the current watermark on a subsequent call', async () => {
    const db = await UsageDb.create();
    db.insertChatEvent(chatEvent({ spanId: 'sp_1', timestampMs: 1000 }));
    await exportNewEvents(db, { send: vi.fn().mockResolvedValue(undefined) }, envelope);

    db.insertChatEvent(chatEvent({ spanId: 'sp_2', timestampMs: 2000 }));
    const send = vi.fn().mockResolvedValue(undefined);
    await exportNewEvents(db, { send }, envelope);

    const sentDocs = send.mock.calls[0]?.[0] as Array<{ _id: string }>;
    expect(sentDocs.map((d) => d._id)).toEqual(['sp_2']);

    db.close();
  });

  it('does NOT advance the watermark when the sink fails, so the next call retries the same rows', async () => {
    const db = await UsageDb.create();
    db.insertChatEvent(chatEvent({ spanId: 'sp_1', timestampMs: 1000 }));
    const failingSend = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(exportNewEvents(db, { send: failingSend }, envelope)).rejects.toThrow('network down');
    expect(db.getExportWatermarkMs()).toBeNull();

    // A subsequent, successful call must see the SAME row again, not skip it.
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await exportNewEvents(db, { send }, envelope);
    expect(result.exportedCount).toBe(1);

    db.close();
  });
});
