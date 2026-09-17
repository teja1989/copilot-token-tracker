import type { StoredChatEvent, StoredToolCallEvent } from '../storage/db.js';

export interface ExportEnvelope {
  orgId: string;
  /** Pseudonymous id from pseudonymize.ts, or null under the fully-anonymous identity option. */
  userId: string | null;
  installationId: string;
  extensionVersion: string;
}

/**
 * Maps a locally-stored row to the Mongo document shape in docs/mongo-team-rollup.md.
 * `_id = spanId` so a retried export is a safe upsert, not a duplicate — see that doc's
 * "Idempotency" section. `realCreditsUsd` is reconstructed from `costSource`/`usdCost`
 * rather than stored separately locally: when costSource is 'real', usdCost IS the real
 * figure by definition, so nothing is actually lost by not keeping a second column for it.
 */
export function chatEventToExportDocument(row: StoredChatEvent, envelope: ExportEnvelope): Record<string, unknown> {
  return {
    _id: row.spanId,
    kind: 'chat',
    orgId: envelope.orgId,
    userId: envelope.userId,
    installationId: envelope.installationId,
    extensionVersion: envelope.extensionVersion,
    conversationId: row.conversationId,
    chatSessionId: row.chatSessionId,
    turnIndex: row.turnIndex,
    timestampMs: row.timestampMs,
    provider: row.provider,
    requestedModel: row.requestedModel,
    resolvedModel: row.resolvedModel,
    agentName: row.agentName,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedTokens: row.cachedTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    reasoningTokens: row.reasoningTokens,
    timeToFirstTokenMs: row.timeToFirstTokenMs,
    realCreditsUsd: row.costSource === 'real' ? row.usdCost : null,
    usdCost: row.usdCost,
    premiumRequestUnits: row.premiumRequestUnits,
    costSource: row.costSource
  };
}

export function toolCallEventToExportDocument(row: StoredToolCallEvent, envelope: ExportEnvelope): Record<string, unknown> {
  return {
    _id: row.spanId,
    kind: 'tool_call',
    orgId: envelope.orgId,
    userId: envelope.userId,
    installationId: envelope.installationId,
    extensionVersion: envelope.extensionVersion,
    conversationId: row.conversationId,
    chatSessionId: row.chatSessionId,
    turnIndex: row.turnIndex,
    timestampMs: row.timestampMs,
    agentName: row.agentName,
    toolName: row.toolName,
    toolType: row.toolType,
    toolCallId: row.toolCallId,
    errorType: row.errorType,
    durationMs: row.durationMs
  };
}
