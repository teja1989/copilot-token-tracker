import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { AGGREGATE_AGENT_NAME, mapTraceRow, readTraceSpansFromDb } from '../src/ingest/tracesDb.js';

const SCHEMA = `
CREATE TABLE spans (
  span_id TEXT PRIMARY KEY,
  chat_session_id TEXT,
  conversation_id TEXT,
  agent_name TEXT,
  operation_name TEXT,
  request_model TEXT,
  response_model TEXT,
  provider_name TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,
  tool_name TEXT,
  turn_index INTEGER,
  ttft_ms INTEGER,
  start_time_ms INTEGER,
  end_time_ms INTEGER,
  status_code INTEGER
);
CREATE TABLE span_attributes (
  span_id TEXT,
  key TEXT,
  value TEXT
);
`;

async function buildTestDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(SCHEMA);
  return db;
}

describe('mapTraceRow', () => {
  it('maps a chat row, including real credits from the joined nano_aiu attribute', () => {
    const { event, warning } = mapTraceRow({
      span_id: 'span-1',
      chat_session_id: 'chat-1',
      conversation_id: 'chat-1',
      agent_name: 'panel/editAgent',
      operation_name: 'chat',
      request_model: 'claude-sonnet-4.6',
      response_model: 'claude-sonnet-4-6-20260201',
      provider_name: 'github',
      input_tokens: 1000,
      output_tokens: 500,
      cached_tokens: 800,
      reasoning_tokens: 0,
      turn_index: 2,
      ttft_ms: 350,
      start_time_ms: 1700000000000,
      nano_aiu: 45_000_000 // 0.045 real credits
    });
    expect(warning).toBeNull();
    expect(event?.kind).toBe('chat');
    if (event?.kind === 'chat') {
      expect(event.agentName).toBe('panel/editAgent');
      expect(event.turnIndex).toBe(2);
      expect(event.cachedTokens).toBe(800);
      expect(event.cacheWriteTokens).toBeNull(); // not a column in this schema, see tracesDb.ts
      expect(event.realCreditsUsd).toBeCloseTo(0.045);
    }
  });

  it('maps a tool-call row, deriving errorType from the numeric OTel status code', () => {
    const { event } = mapTraceRow({
      span_id: 'span-2',
      chat_session_id: 'chat-1',
      conversation_id: 'chat-1',
      agent_name: 'panel/editAgent',
      operation_name: 'execute_tool',
      tool_name: 'readFile',
      start_time_ms: 1700000000500,
      end_time_ms: 1700000000900,
      status_code: 2 // OTel STATUS_CODE_ERROR
    });
    expect(event?.kind).toBe('tool_call');
    if (event?.kind === 'tool_call') {
      expect(event.errorType).toBe('error');
      expect(event.durationMs).toBe(400);
    }
  });

  it('fails safe when required fields are missing', () => {
    const { event, warning } = mapTraceRow({ operation_name: 'chat' });
    expect(event).toBeNull();
    expect(warning).toContain('span_id');
  });
});

describe('readTraceSpansFromDb', () => {
  it('excludes AGGREGATE_AGENT_NAME rollup rows so totals are not double-counted', async () => {
    const db = await buildTestDb();
    db.run(
      `INSERT INTO spans (span_id, chat_session_id, conversation_id, agent_name, operation_name,
        request_model, response_model, input_tokens, output_tokens, start_time_ms)
       VALUES
        ('real-1', 'chat-1', 'chat-1', 'panel/editAgent', 'chat', 'gpt-4o', 'gpt-4o-2024-08-06', 100, 50, 1000),
        ('rollup-1', 'chat-1', 'chat-1', ?, 'chat', 'gpt-4o', 'gpt-4o-2024-08-06', 100, 50, 1000)`,
      [AGGREGATE_AGENT_NAME]
    );

    const { results, excludedAggregateRollups } = readTraceSpansFromDb(db);

    expect(excludedAggregateRollups).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.event?.spanId).toBe('real-1');

    db.close();
  });

  it('joins the real-credits attribute only to the span it belongs to', async () => {
    const db = await buildTestDb();
    db.run(
      `INSERT INTO spans (span_id, chat_session_id, conversation_id, agent_name, operation_name, start_time_ms)
       VALUES ('span-a', 'chat-1', 'chat-1', 'Explore', 'chat', 1000),
              ('span-b', 'chat-1', 'chat-1', 'Explore', 'chat', 2000)`
    );
    db.run(`INSERT INTO span_attributes (span_id, key, value) VALUES ('span-a', 'copilot_chat.copilot_usage_nano_aiu', '9000000')`);

    const { results } = readTraceSpansFromDb(db);
    const byId = new Map(results.map((r) => [r.event?.spanId, r.event]));

    expect(byId.get('span-a')?.kind === 'chat' && (byId.get('span-a') as { realCreditsUsd: number | null }).realCreditsUsd).toBeCloseTo(0.009);
    expect(byId.get('span-b')?.kind === 'chat' && (byId.get('span-b') as { realCreditsUsd: number | null }).realCreditsUsd).toBeNull();

    db.close();
  });
});
