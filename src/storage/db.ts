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

-- Small key/value table for cross-restart state that isn't an aggregate, e.g. the
-- team-export watermark (src/export/). Lives in the same sql.js DB so it persists for
-- free via the existing exportBytes()/load() round trip — no separate file needed.
CREATE TABLE IF NOT EXISTS export_state (
  key TEXT PRIMARY KEY,
  value INTEGER
);
`;

const EXPORT_WATERMARK_KEY = 'last_exported_ms';

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

/**
 * A stored chat_events row, raw (not aggregated) — what team export sends one document
 * per row of, unlike the aggregate queries above. Includes the cost fields exactly as
 * already computed by insertChatEvent()/estimateEventCost(), so export never recomputes
 * pricing — see docs/mongo-team-rollup.md.
 */
export interface StoredChatEvent {
  spanId: string;
  conversationId: string;
  chatSessionId: string | null;
  turnIndex: number | null;
  timestampMs: number;
  provider: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  agentName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  timeToFirstTokenMs: number | null;
  usdCost: number | null;
  premiumRequestUnits: number | null;
  costSource: string | null;
}

export interface StoredToolCallEvent {
  spanId: string;
  conversationId: string;
  chatSessionId: string | null;
  turnIndex: number | null;
  timestampMs: number;
  agentName: string | null;
  toolName: string | null;
  toolType: string | null;
  toolCallId: string | null;
  errorType: string | null;
  durationMs: number | null;
}

function toNullableNumber(v: unknown): number | null {
  return v == null ? null : Number(v);
}
function toNullableString(v: unknown): string | null {
  return v == null ? null : String(v);
}

function execToObjects(db: Database, sql: string): Record<string, unknown>[] {
  const results = db.exec(sql);
  if (results.length === 0) return [];
  const { columns, values } = results[0]!;
  return values.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

function queryToObjects(db: Database, sql: string, params: (string | number | null)[]): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
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

  /**
   * The team-export watermark: distinct from getLatestTimestampMs() above on purpose.
   * That one tracks "have we read this span from agent-traces.db yet"; this one tracks
   * "have we successfully sent this span to the team API yet". They must be independent
   * — an export failure (API down) must never block local ingestion, and must never
   * cause a span to be silently skipped for export just because local ingestion has
   * already moved past it. See src/export/exportManager.ts.
   */
  getExportWatermarkMs(): number | null {
    const rows = queryToObjects(this.db, 'SELECT value FROM export_state WHERE key = ?', [EXPORT_WATERMARK_KEY]);
    return toNullableNumber(rows[0]?.['value']);
  }

  setExportWatermarkMs(value: number): void {
    this.db.run(`INSERT OR REPLACE INTO export_state (key, value) VALUES (?, ?)`, [EXPORT_WATERMARK_KEY, value]);
  }

  /** Raw (non-aggregated) chat event rows newer than `sinceMs`, oldest first, for team export. */
  getChatEventsSince(sinceMs: number | null): StoredChatEvent[] {
    const clause = sinceMs != null ? 'WHERE timestamp_ms > ?' : '';
    const rows = queryToObjects(
      this.db,
      `SELECT span_id, conversation_id, chat_session_id, turn_index, timestamp_ms, provider,
              requested_model, resolved_model, agent_name, input_tokens, output_tokens,
              cached_tokens, cache_write_tokens, reasoning_tokens, time_to_first_token_ms,
              usd_cost, premium_request_units, cost_source
       FROM chat_events ${clause} ORDER BY timestamp_ms ASC`,
      sinceMs != null ? [sinceMs] : []
    );
    return rows.map((r) => ({
      spanId: String(r['span_id']),
      conversationId: String(r['conversation_id']),
      chatSessionId: toNullableString(r['chat_session_id']),
      turnIndex: toNullableNumber(r['turn_index']),
      timestampMs: Number(r['timestamp_ms']),
      provider: toNullableString(r['provider']),
      requestedModel: toNullableString(r['requested_model']),
      resolvedModel: toNullableString(r['resolved_model']),
      agentName: toNullableString(r['agent_name']),
      inputTokens: toNullableNumber(r['input_tokens']),
      outputTokens: toNullableNumber(r['output_tokens']),
      cachedTokens: toNullableNumber(r['cached_tokens']),
      cacheWriteTokens: toNullableNumber(r['cache_write_tokens']),
      reasoningTokens: toNullableNumber(r['reasoning_tokens']),
      timeToFirstTokenMs: toNullableNumber(r['time_to_first_token_ms']),
      usdCost: toNullableNumber(r['usd_cost']),
      premiumRequestUnits: toNullableNumber(r['premium_request_units']),
      costSource: toNullableString(r['cost_source'])
    }));
  }

  /** Raw (non-aggregated) tool-call event rows newer than `sinceMs`, oldest first, for team export. */
  getToolCallEventsSince(sinceMs: number | null): StoredToolCallEvent[] {
    const clause = sinceMs != null ? 'WHERE timestamp_ms > ?' : '';
    const rows = queryToObjects(
      this.db,
      `SELECT span_id, conversation_id, chat_session_id, turn_index, timestamp_ms, agent_name,
              tool_name, tool_type, tool_call_id, error_type, duration_ms
       FROM tool_call_events ${clause} ORDER BY timestamp_ms ASC`,
      sinceMs != null ? [sinceMs] : []
    );
    return rows.map((r) => ({
      spanId: String(r['span_id']),
      conversationId: String(r['conversation_id']),
      chatSessionId: toNullableString(r['chat_session_id']),
      turnIndex: toNullableNumber(r['turn_index']),
      timestampMs: Number(r['timestamp_ms']),
      agentName: toNullableString(r['agent_name']),
      toolName: toNullableString(r['tool_name']),
      toolType: toNullableString(r['tool_type']),
      toolCallId: toNullableString(r['tool_call_id']),
      errorType: toNullableString(r['error_type']),
      durationMs: toNullableNumber(r['duration_ms'])
    }));
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
