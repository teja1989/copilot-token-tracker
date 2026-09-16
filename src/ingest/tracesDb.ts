import { readFileSync } from 'node:fs';
import initSqlJs, { type Database } from 'sql.js';
import type { NormalizeResult } from '../model/events.js';

/**
 * Verified by reading Hoxlegion/copilot-cost-tracker-vsc's `src/parser/tracesDbReader.ts`
 * and `src/parser/types.ts` directly (see PLAN.md) — this is a real, shipped
 * implementation reading Copilot Chat's own SQLite output, not a guess. Copilot Chat
 * emits a rollup span named exactly this, at the conversation level, which duplicates
 * the real per-surface spans underneath it and never carries the real-billing attribute.
 * Rows with this agent_name must be excluded from any per-model/per-agent aggregation or
 * every total silently doubles.
 */
export const AGGREGATE_AGENT_NAME = 'GitHub Copilot Chat';

const NANO_AIU_ATTRIBUTE_KEY = 'copilot_chat.copilot_usage_nano_aiu';

export interface RawTraceRow {
  span_id?: unknown;
  chat_session_id?: unknown;
  conversation_id?: unknown;
  agent_name?: unknown;
  operation_name?: unknown;
  request_model?: unknown;
  response_model?: unknown;
  provider_name?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  cached_tokens?: unknown;
  reasoning_tokens?: unknown;
  tool_name?: unknown;
  turn_index?: unknown;
  ttft_ms?: unknown;
  start_time_ms?: unknown;
  end_time_ms?: unknown;
  status_code?: unknown;
  nano_aiu?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Maps one `spans` (+ joined `span_attributes`) row into a normalized event. Pure and
 * synchronous so it's testable without a real SQLite file — the DB-reading/query layer
 * below is a thin, separately-testable I/O wrapper around this.
 */
export function mapTraceRow(row: RawTraceRow): NormalizeResult {
  const spanId = str(row.span_id);
  const conversationId = str(row.conversation_id) ?? str(row.chat_session_id);
  const startTimeMs = num(row.start_time_ms);
  const operation = str(row.operation_name);

  if (spanId == null || conversationId == null || startTimeMs == null) {
    return {
      event: null,
      warning: `trace row missing required field(s): ${[
        spanId == null ? 'span_id' : null,
        conversationId == null ? 'conversation_id/chat_session_id' : null,
        startTimeMs == null ? 'start_time_ms' : null
      ]
        .filter(Boolean)
        .join(', ')}`
    };
  }

  const agentName = str(row.agent_name);
  const chatSessionId = str(row.chat_session_id);
  const turnIndex = num(row.turn_index);
  const nanoAiu = num(row.nano_aiu);
  const realCreditsUsd = nanoAiu != null && nanoAiu >= 0 ? nanoAiu / 1_000_000_000 : null;

  if (operation === 'chat') {
    return {
      event: {
        kind: 'chat',
        conversationId,
        spanId,
        timestampMs: startTimeMs,
        provider: str(row.provider_name),
        requestedModel: str(row.request_model),
        resolvedModel: str(row.response_model),
        agentName,
        chatSessionId,
        turnIndex,
        inputTokens: num(row.input_tokens),
        outputTokens: num(row.output_tokens),
        cachedTokens: num(row.cached_tokens),
        // Not a column in this schema (verified against the reference reader, which
        // hardcodes it to 0 rather than reading it). We use null instead of a hardcoded
        // 0 to keep "unknown" distinguishable from "known to be zero" — see
        // src/pricing/tokenPricing.ts, which already treats a null cacheWriteTokens as 0
        // for cost math, so this changes nothing about the resulting numbers.
        cacheWriteTokens: null,
        reasoningTokens: num(row.reasoning_tokens),
        timeToFirstTokenMs: num(row.ttft_ms),
        realCreditsUsd
      },
      warning: null
    };
  }

  if (operation === 'execute_tool') {
    const endTimeMs = num(row.end_time_ms);
    const statusCode = num(row.status_code);
    return {
      event: {
        kind: 'tool_call',
        conversationId,
        spanId,
        timestampMs: startTimeMs,
        agentName,
        chatSessionId,
        turnIndex,
        toolName: str(row.tool_name),
        toolType: null, // not a column in this schema
        toolCallId: null, // not a column in this schema
        // This schema only has a numeric OTel status code (2 == ERROR), not the OTel
        // `error.type` string attribute the file/OTLP exporter path carries — coarser
        // signal here by necessity, not a design choice.
        errorType: statusCode === 2 ? 'error' : null,
        durationMs: endTimeMs != null ? Math.max(0, endTimeMs - startTimeMs) : null
      },
      warning: null
    };
  }

  return { event: null, warning: `unrecognized operation_name in trace row: ${operation ?? '(missing)'}` };
}

interface TracesDbQueryResult {
  results: NormalizeResult[];
  excludedAggregateRollups: number;
}

/**
 * Reads and maps every span row from an already-open sql.js Database, excluding
 * `AGGREGATE_AGENT_NAME` rollup rows at the SQL level (not after fetching) so callers
 * never see them and can't accidentally double-count. `sinceMs` is an optional lower
 * bound on `start_time_ms` for incremental ingestion. The exclusion count is a separate,
 * cheap query rather than a second filter pass over rows we've already excluded from the
 * main query — counting something after already having filtered it out in SQL would be
 * dead code that can never run.
 */
export function readTraceSpansFromDb(db: Database, sinceMs?: number): TracesDbQueryResult {
  const conditions = [`s.agent_name IS NOT '${AGGREGATE_AGENT_NAME}'`];
  const rollupConditions = [`agent_name = '${AGGREGATE_AGENT_NAME}'`];
  const params: number[] = [];
  if (sinceMs !== undefined) {
    conditions.push('s.start_time_ms > ?');
    rollupConditions.push('start_time_ms > ?');
    params.push(sinceMs);
  }

  const stmt = db.prepare(
    `SELECT s.span_id, s.chat_session_id, s.conversation_id, s.agent_name, s.operation_name,
            s.request_model, s.response_model, s.provider_name, s.input_tokens, s.output_tokens,
            s.cached_tokens, s.reasoning_tokens, s.tool_name, s.turn_index, s.ttft_ms,
            s.start_time_ms, s.end_time_ms, s.status_code,
            sa.value AS nano_aiu
     FROM spans s
     LEFT JOIN span_attributes sa ON sa.span_id = s.span_id AND sa.key = '${NANO_AIU_ATTRIBUTE_KEY}'
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.start_time_ms ASC`
  );
  if (params.length > 0) stmt.bind(params);

  const results: NormalizeResult[] = [];
  while (stmt.step()) {
    results.push(mapTraceRow(stmt.getAsObject() as RawTraceRow));
  }
  stmt.free();

  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM spans WHERE ${rollupConditions.join(' AND ')}`);
  if (params.length > 0) countStmt.bind(params);
  countStmt.step();
  const excludedAggregateRollups = Number((countStmt.getAsObject() as { n?: unknown }).n ?? 0);
  countStmt.free();

  return { results, excludedAggregateRollups };
}

/**
 * Opens agent-traces.db read-only from disk and returns the mapped span results. The SQL
 * `WHERE agent_name IS NOT '...'` clause above already excludes rollups at the query
 * level; the extra check in the loop guards against sql.js building variants where that
 * clause behaves unexpectedly on NULL agent_name rows, at negligible cost.
 */
export async function readTraceSpansFromFile(dbFilePath: string, sinceMs?: number): Promise<TracesDbQueryResult> {
  const buffer = readFileSync(dbFilePath);
  const SQL = await initSqlJs();
  const db = new SQL.Database(buffer);
  try {
    return readTraceSpansFromDb(db, sinceMs);
  } finally {
    db.close();
  }
}
