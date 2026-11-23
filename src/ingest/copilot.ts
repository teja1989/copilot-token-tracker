import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import type { TelemetryEvent } from '../model/types.js';
import { estimateEventCost } from '../pricing/estimator.js';

/**
 * Copilot Chat writes a conversation-level rollup span named 'GitHub Copilot Chat'
 * that duplicates the per-surface child spans underneath it. Exclude it to prevent
 * double-counting.
 */
export const COPILOT_ROLLUP_AGENT = 'GitHub Copilot Chat';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

export interface CopilotTraceRow {
  span_id?: string | null;
  parent_span_id?: string | null;
  chat_session_id?: string | null;
  conversation_id?: string | null;
  agent_name?: string | null;
  operation_name?: string | null;
  request_model?: string | null;
  response_model?: string | null;
  provider_name?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_tokens?: number | null;
  reasoning_tokens?: number | null;
  tool_name?: string | null;
  ttft_ms?: number | null;
  start_time_ms?: number | null;
  end_time_ms?: number | null;
  status_code?: number | string | null;
  nano_aiu?: number | null;
}

export function mapCopilotTraceRow(row: CopilotTraceRow): TelemetryEvent | null {
  const agentName = row.agent_name?.trim() || 'Copilot Agent';
  if (agentName === COPILOT_ROLLUP_AGENT) return null;

  const spanId = row.span_id?.trim();
  const convId = row.conversation_id?.trim() || row.chat_session_id?.trim();
  if (!spanId || !convId) return null;

  const inputTokens = Math.max(0, Number(row.input_tokens ?? 0) || 0);
  const outputTokens = Math.max(0, Number(row.output_tokens ?? 0) || 0);
  const cachedReadTokens = Math.max(0, Number(row.cached_tokens ?? 0) || 0);
  const reasoningTokens = Math.max(0, Number(row.reasoning_tokens ?? 0) || 0);
  const totalTokens = inputTokens + outputTokens + cachedReadTokens + reasoningTokens;

  const model = (row.response_model || row.request_model || 'copilot-unknown').trim();
  const startTimeMs = Number(row.start_time_ms) || Date.now();
  const endTimeMs = Number(row.end_time_ms) || startTimeMs + 500;
  const durationMs = Math.max(0, endTimeMs - startTimeMs);

  const cost = estimateEventCost({
    model,
    provider: row.provider_name ?? undefined,
    inputTokens,
    outputTokens,
    cachedReadTokens,
    reasoningTokens,
  });

  const isError = row.status_code === 2 || row.status_code === 'ERROR' || row.status_code === 'error';
  const toolName = row.tool_name?.trim() || null;

  return {
    id: `copilot:${spanId}`,
    source: 'copilot',
    isSimulated: false,
    workflowId: `copilot:${convId}`,
    workflowName: `GitHub Copilot · ${convId.slice(0, 8)}`,
    agentId: `copilot:${convId}:${agentName}`,
    agentName,
    agentRole: inferCopilotRole(agentName),
    parentSpanId: row.parent_span_id ? `copilot:${row.parent_span_id}` : null,
    parentAgentId: null,
    kind: toolName ? 'tool' : 'llm',
    operation: row.operation_name?.trim() || (toolName ? `tool:${toolName}` : 'chat'),
    toolName,
    provider: cost.provider,
    model,
    inputTokens,
    outputTokens,
    cachedReadTokens,
    cacheWriteTokens: 0,
    reasoningTokens,
    totalTokens,
    estimatedCostUsd: cost.estimatedCostUsd,
    cacheSavingsUsd: cost.cacheSavingsUsd,
    copilotPremiumRequests: cost.copilotPremiumRequests,
    costSource: cost.costSource,
    startTimeMs,
    endTimeMs,
    durationMs,
    ttftMs: typeof row.ttft_ms === 'number' ? row.ttft_ms : null,
    status: isError ? 'error' : 'ok',
    project: 'VS Code',
    metadata: row.nano_aiu != null ? { nanoAiu: row.nano_aiu } : undefined,
  };
}

function inferCopilotRole(agentName: string): string {
  const lower = agentName.toLowerCase();
  if (lower.includes('edit') || lower.includes('coding') || lower.includes('agent')) return 'Coder';
  if (lower.includes('plan')) return 'Planner';
  if (lower.includes('review') || lower.includes('test')) return 'Reviewer';
  if (lower.includes('search') || lower.includes('workspace') || lower.includes('explore')) return 'Researcher';
  return 'Assistant';
}

export async function readCopilotTracesDb(dbPath: string): Promise<TelemetryEvent[]> {
  const SQL = await getSqlJs();
  const buf = readFileSync(dbPath);
  const db = new SQL.Database(buf);
  const events: TelemetryEvent[] = [];

  try {
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='spans'");
    if (!tables.length || !tables[0].values.length) {
      return [];
    }

    const colResult = db.exec('PRAGMA table_info(spans)');
    const cols = new Set(colResult[0]?.values.map((r) => String(r[1])) ?? []);
    const hasParent = cols.has('parent_span_id');
    const hasAttrTable =
      (db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='span_attributes'")[0]?.values.length ?? 0) > 0;

    const selectParent = hasParent ? 's.parent_span_id,' : 'NULL AS parent_span_id,';
    const joinAttr = hasAttrTable
      ? `LEFT JOIN span_attributes a ON a.span_id = s.span_id AND a.key = 'copilot_chat.copilot_usage_nano_aiu'`
      : '';
    const selectAiu = hasAttrTable ? 'a.value AS nano_aiu' : 'NULL AS nano_aiu';

    const query = `
      SELECT
        s.span_id,
        ${selectParent}
        s.chat_session_id,
        s.conversation_id,
        s.agent_name,
        s.operation_name,
        s.request_model,
        s.response_model,
        s.provider_name,
        s.input_tokens,
        s.output_tokens,
        s.cached_tokens,
        s.reasoning_tokens,
        s.tool_name,
        s.ttft_ms,
        s.start_time_ms,
        s.end_time_ms,
        s.status_code,
        ${selectAiu}
      FROM spans s
      ${joinAttr}
      ORDER BY s.start_time_ms ASC
    `;

    const res = db.exec(query);
    if (!res.length) return [];
    const colNames = res[0].columns;

    for (const values of res[0].values) {
      const row: Record<string, unknown> = {};
      colNames.forEach((c, idx) => {
        row[c] = values[idx];
      });
      const mapped = mapCopilotTraceRow(row as CopilotTraceRow);
      if (mapped) events.push(mapped);
    }
  } finally {
    db.close();
  }

  return events;
}

interface CopilotChatSessionFile {
  sessionId?: string;
  customTitle?: string;
  creationDate?: number;
  requests?: Array<{
    requestId?: string;
    timestamp?: number;
    modelId?: string;
    agent?: { id?: string; name?: string };
    message?: { text?: string };
    response?: Array<{ value?: string }>;
    result?: {
      timings?: { totalElapsed?: number; firstProgress?: number };
      metadata?: {
        modelMessageId?: string;
        promptTokens?: number;
        completionTokens?: number;
      };
    };
  }>;
}

export function parseCopilotChatSessionJson(content: string, filePath: string): TelemetryEvent[] {
  let doc: CopilotChatSessionFile;
  try {
    doc = JSON.parse(content) as CopilotChatSessionFile;
  } catch {
    return [];
  }
  if (!Array.isArray(doc.requests) || doc.requests.length === 0) return [];

  const sessionId = doc.sessionId ?? basename(filePath, '.json');
  const events: TelemetryEvent[] = [];

  for (let i = 0; i < doc.requests.length; i++) {
    const req = doc.requests[i];
    const reqId = req.requestId ?? `${sessionId}:${i}`;
    const model = req.modelId?.replace(/^copilot\//, '') ?? 'gpt-4o';
    const agentName = req.agent?.name ?? req.agent?.id ?? 'GitHub Copilot';

    const promptText = req.message?.text ?? '';
    const responseText = Array.isArray(req.response)
      ? req.response.map((r) => (typeof r?.value === 'string' ? r.value : '')).join('')
      : '';

    // Use real token counts if present, otherwise rough 4-char/token fallback
    const inputTokens = req.result?.metadata?.promptTokens ?? Math.max(10, Math.round(promptText.length / 4));
    const outputTokens = req.result?.metadata?.completionTokens ?? Math.max(10, Math.round(responseText.length / 4));
    const startTimeMs = req.timestamp ?? doc.creationDate ?? Date.now();
    const durationMs = req.result?.timings?.totalElapsed ?? 1200;

    const cost = estimateEventCost({
      model,
      inputTokens,
      outputTokens,
    });

    events.push({
      id: `copilot-chat:${reqId}`,
      source: 'copilot',
      isSimulated: false,
      workflowId: `copilot-chat:${sessionId}`,
      workflowName: doc.customTitle ? `Copilot · ${doc.customTitle}` : `Copilot Chat · ${sessionId.slice(0, 8)}`,
      agentId: `copilot-chat:${sessionId}:${agentName}`,
      agentName,
      agentRole: inferCopilotRole(agentName),
      kind: 'llm',
      operation: 'chat.request',
      provider: cost.provider,
      model,
      inputTokens,
      outputTokens,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: cost.estimatedCostUsd,
      cacheSavingsUsd: cost.cacheSavingsUsd,
      copilotPremiumRequests: cost.copilotPremiumRequests,
      costSource: cost.costSource,
      startTimeMs,
      endTimeMs: startTimeMs + durationMs,
      durationMs,
      ttftMs: req.result?.timings?.firstProgress ?? null,
      status: 'ok',
      project: 'VS Code',
    });
  }

  return events;
}

export function parseCopilotChatSessionJsonl(content: string, filePath: string): TelemetryEvent[] {
  // Newer VS Code versions write append-only JSONL patches:
  // { kind: 0, v: { sessionId, requests: [...] } }
  // { kind: 2, k: ["requests"], v: [ ...newRequests ] }
  const session: CopilotChatSessionFile = { requests: [] };
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const patch = JSON.parse(line) as { kind?: number; k?: string[]; v?: unknown };
      if (patch.kind === 0 && patch.v && typeof patch.v === 'object') {
        const init = patch.v as CopilotChatSessionFile;
        if (init.sessionId) session.sessionId = init.sessionId;
        if (init.customTitle) session.customTitle = init.customTitle;
        if (init.creationDate) session.creationDate = init.creationDate;
        if (Array.isArray(init.requests)) session.requests = [...init.requests];
      } else if (
        patch.kind === 2 &&
        Array.isArray(patch.k) &&
        patch.k[0] === 'requests' &&
        Array.isArray(patch.v)
      ) {
        session.requests = [...(session.requests ?? []), ...(patch.v as NonNullable<CopilotChatSessionFile['requests']>)];
      }
    } catch {
      // Skip malformed line
    }
  }
  return parseCopilotChatSessionJson(JSON.stringify(session), filePath);
}

export function readCopilotChatSessionFile(filePath: string): TelemetryEvent[] {
  const content = readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.jsonl')) {
    return parseCopilotChatSessionJsonl(content, filePath);
  }
  return parseCopilotChatSessionJson(content, filePath);
}

/**
 * Parses VS Code's `GitHub Copilot Chat.log` files, which are ALWAYS written even when
 * `agent-traces.db` is disabled. Captures lines of the form:
 *   2025-12-18 19:19:23.164 [info] ccreq:b16be73a.copilotmd | success | gpt-4o-mini-2024-07-18 | 325ms | [title]
 */
const CCREQ_RE =
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+\[\w+\]\s+ccreq:([a-zA-Z0-9_-]+)\.copilotmd\s+\|\s+(\w+)\s+\|\s+([^|]+?)\s+\|\s+(\d+)ms\s+\|\s+\[([^\]]+)\]/;

export function parseCopilotChatLog(content: string, filePath: string): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  // Group requests by VS Code log session folder (e.g. 20261010T141911)
  const pathParts = filePath.replace(/\\/g, '/').split('/');
  const logsIdx = pathParts.lastIndexOf('logs');
  const sessionFolder = logsIdx >= 0 && pathParts[logsIdx + 1] ? pathParts[logsIdx + 1] : 'vscode-session';

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line.includes('ccreq:')) continue;
    const m = CCREQ_RE.exec(line);
    if (!m) continue;

    const [, tsRaw, reqId, statusRaw, modelRaw, durationRaw, surfaceRaw] = m;
    const endTimeMs = Date.parse(tsRaw.replace(' ', 'T')) || Date.now();
    const durationMs = Math.max(1, Number(durationRaw) || 200);
    const startTimeMs = endTimeMs - durationMs;
    const model = modelRaw.trim();
    const surface = surfaceRaw.trim();
    const status = statusRaw.toLowerCase() === 'success' ? 'ok' : 'error';

    // Copilot Chat.log does not print exact token counts for every request;
    // record the real request, model, latency, surface, and Copilot premium multiplier.
    const cost = estimateEventCost({
      model,
      inputTokens: 0,
      outputTokens: 0,
    });

    events.push({
      id: `copilot-log:${sessionFolder}:${reqId}`,
      source: 'copilot',
      isSimulated: false,
      workflowId: `copilot-log:${sessionFolder}`,
      workflowName: `Copilot Session · ${sessionFolder}`,
      agentId: `copilot-log:${sessionFolder}:${surface}`,
      agentName: `Copilot · ${surface}`,
      agentRole: inferCopilotRole(surface),
      kind: 'llm',
      operation: `copilot:${surface}`,
      provider: cost.provider,
      model,
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: cost.estimatedCostUsd,
      cacheSavingsUsd: 0,
      copilotPremiumRequests: cost.copilotPremiumRequests,
      costSource: cost.costSource,
      startTimeMs,
      endTimeMs,
      durationMs,
      status,
      project: 'VS Code',
      metadata: { logSource: 'GitHub Copilot Chat.log', surface },
    });
  }

  return events;
}

export function readCopilotChatLogFile(filePath: string): TelemetryEvent[] {
  const content = readFileSync(filePath, 'utf8');
  return parseCopilotChatLog(content, filePath);
}
