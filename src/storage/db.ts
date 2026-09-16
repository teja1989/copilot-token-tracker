import initSqlJs, { type Database } from 'sql.js';
import type { ChatEvent, ToolCallEvent } from '../model/events.js';
import { estimateEventCost } from '../pricing/estimateCost.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_events (
  span_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  chat_session_id TEXT,
  turn_index INTEGER,
  timestamp_ms INTEGER NOT NULL,
  provider TEXT,
  requested_model TEXT,
  resolved_model TEXT,
  agent_name TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  time_to_first_token_ms INTEGER,
  usd_cost REAL,
  premium_request_units REAL,
  cost_source TEXT
);

CREATE TABLE IF NOT EXISTS tool_call_events (
  span_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  chat_session_id TEXT,
  turn_index INTEGER,
  timestamp_ms INTEGER NOT NULL,
  agent_name TEXT,
  tool_name TEXT,
  tool_type TEXT,
  tool_call_id TEXT,
  error_type TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chat_events_ts ON chat_events(timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_tool_call_events_ts ON tool_call_events(timestamp_ms);
`;

export interface ModelAggregate {
  model: string;
  requestCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalUsdCost: number;
  totalPremiumRequestUnits: number;
}

export interface AgentAggregate {
  agentName: string;
  chatRequestCount: number;
  toolCallCount: number;
  toolErrorCount: number;
}

function execToObjects(db: Database, sql: string): Record<string, unknown>[] {
  const results = db.exec(sql);
  if (results.length === 0) return [];
  const { columns, values } = results[0]!;
  return values.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

export class UsageDb {
  private constructor(private readonly db: Database) {}

  static async create(wasmBinaryPath?: string): Promise<UsageDb> {
    return UsageDb.load(undefined, wasmBinaryPath);
  }

  /**
   * Creates a fresh DB, or restores one previously persisted via `exportBytes()`.
   * Used by the extension host to survive VS Code restarts: sql.js is in-memory only,
   * so persistence means serializing to a file (globalStorage) and reloading it here on
   * activation, not anything the library does automatically.
   *
   * `wasmBinaryPath`, when given, is passed through as sql.js's `locateFile` target. The
   * packaged extension bundles sql.js's JS directly (not as a separate node_modules
   * package — see scripts/build-extension.mjs) and ships only the one .wasm file it
   * actually needs, so it has to tell sql.js exactly where that file landed. Left
   * undefined in tests/dev tooling, where sql.js's own default resolution (via its real
   * node_modules location) already works.
   */
  static async load(bytes?: Uint8Array, wasmBinaryPath?: string): Promise<UsageDb> {
    const SQL = await initSqlJs(wasmBinaryPath ? { locateFile: () => wasmBinaryPath } : undefined);
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    db.run(SCHEMA);
    return new UsageDb(db);
  }

  exportBytes(): Uint8Array {
    return this.db.export();
  }

  /** Latest ingested event timestamp, for incremental "only fetch spans newer than this" ingestion. */
  getLatestTimestampMs(): number | null {
    const rows = execToObjects(
      this.db,
      `SELECT MAX(ts) AS latest FROM (
         SELECT MAX(timestamp_ms) AS ts FROM chat_events
         UNION ALL
         SELECT MAX(timestamp_ms) AS ts FROM tool_call_events
       )`
    );
    const value = rows[0]?.['latest'];
    return value == null ? null : Number(value);
  }

  insertChatEvent(event: ChatEvent): void {
    const cost = estimateEventCost(event);
    const costSource = cost.usdSource ?? (cost.premiumRequestUnits != null ? 'estimated_multiplier' : 'no_match');
    this.db.run(
      `INSERT OR REPLACE INTO chat_events
        (span_id, conversation_id, chat_session_id, turn_index, timestamp_ms, provider,
         requested_model, resolved_model, agent_name, input_tokens, output_tokens,
         cached_tokens, cache_write_tokens, reasoning_tokens, time_to_first_token_ms,
         usd_cost, premium_request_units, cost_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.spanId,
        event.conversationId,
        event.chatSessionId,
        event.turnIndex,
        event.timestampMs,
        event.provider,
        event.requestedModel,
        event.resolvedModel,
        event.agentName,
        event.inputTokens,
        event.outputTokens,
        event.cachedTokens,
        event.cacheWriteTokens,
        event.reasoningTokens,
        event.timeToFirstTokenMs,
        cost.usd,
        cost.premiumRequestUnits,
        costSource
      ]
    );
  }

  insertToolCallEvent(event: ToolCallEvent): void {
    this.db.run(
      `INSERT OR REPLACE INTO tool_call_events
        (span_id, conversation_id, chat_session_id, turn_index, timestamp_ms, agent_name,
         tool_name, tool_type, tool_call_id, error_type, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.spanId,
        event.conversationId,
        event.chatSessionId,
        event.turnIndex,
        event.timestampMs,
        event.agentName,
        event.toolName,
        event.toolType,
        event.toolCallId,
        event.errorType,
        event.durationMs
      ]
    );
  }

  aggregateByModel(): ModelAggregate[] {
    const rows = execToObjects(
      this.db,
      `SELECT
         COALESCE(resolved_model, requested_model, '(unknown)') AS model,
         COUNT(*) AS requestCount,
         COALESCE(SUM(input_tokens), 0) AS totalInputTokens,
         COALESCE(SUM(output_tokens), 0) AS totalOutputTokens,
         COALESCE(SUM(cached_tokens), 0) AS totalCachedTokens,
         COALESCE(SUM(usd_cost), 0) AS totalUsdCost,
         COALESCE(SUM(premium_request_units), 0) AS totalPremiumRequestUnits
       FROM chat_events
       GROUP BY model
       ORDER BY requestCount DESC`
    );
    return rows.map((r) => ({
      model: String(r.model),
      requestCount: Number(r.requestCount),
      totalInputTokens: Number(r.totalInputTokens),
      totalOutputTokens: Number(r.totalOutputTokens),
      totalCachedTokens: Number(r.totalCachedTokens),
      totalUsdCost: Number(r.totalUsdCost),
      totalPremiumRequestUnits: Number(r.totalPremiumRequestUnits)
    }));
  }

  aggregateByAgent(): AgentAggregate[] {
    const rows = execToObjects(
      this.db,
      `SELECT
         agent_name AS agentName,
         COUNT(*) AS chatRequestCount
       FROM chat_events
       WHERE agent_name IS NOT NULL
       GROUP BY agent_name`
    );
    const toolRows = execToObjects(
      this.db,
      `SELECT
         agent_name AS agentName,
         COUNT(*) AS toolCallCount,
         SUM(CASE WHEN error_type IS NOT NULL THEN 1 ELSE 0 END) AS toolErrorCount
       FROM tool_call_events
       WHERE agent_name IS NOT NULL
       GROUP BY agent_name`
    );
    const toolByAgent = new Map(
      toolRows.map((r) => [String(r.agentName), { toolCallCount: Number(r.toolCallCount), toolErrorCount: Number(r.toolErrorCount) }])
    );
    const agentNames = new Set([...rows.map((r) => String(r.agentName)), ...toolByAgent.keys()]);
    return [...agentNames].map((agentName) => ({
      agentName,
      chatRequestCount: Number(rows.find((r) => String(r.agentName) === agentName)?.chatRequestCount ?? 0),
      toolCallCount: toolByAgent.get(agentName)?.toolCallCount ?? 0,
      toolErrorCount: toolByAgent.get(agentName)?.toolErrorCount ?? 0
    }));
  }

  close(): void {
    this.db.close();
  }
}
