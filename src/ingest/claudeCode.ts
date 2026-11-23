import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { TelemetryEvent } from '../model/types.js';
import { estimateEventCost } from '../pricing/estimator.js';

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeContentBlock {
  type?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
}

interface ClaudeRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean;
  agentId?: string | null;
  slug?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    usage?: ClaudeUsage;
    content?: ClaudeContentBlock[] | string;
  };
}

interface FileContext {
  project: string;
  sessionId: string;
  isSubagentFile: boolean;
  subagentFileId: string | null;
}

function parseClaudeFileContext(filePath: string): FileContext {
  const parentDir = dirname(filePath);
  const parentName = basename(parentDir);

  // Pattern: ~/.claude/projects/<projectSlug>/<sessionId>/subagents/agent-<id>.jsonl
  if (parentName === 'subagents') {
    const sessionDir = dirname(parentDir);
    const sessionId = basename(sessionDir);
    const projectSlug = basename(dirname(sessionDir));
    const parts = projectSlug.split('-').filter(Boolean);
    const project = parts.length > 0 ? parts[parts.length - 1] : projectSlug;
    const rawId = basename(filePath, '.jsonl').replace(/^agent-/, '');
    return {
      project,
      sessionId,
      isSubagentFile: true,
      subagentFileId: rawId,
    };
  }

  // Pattern: ~/.claude/projects/<projectSlug>/<sessionId>.jsonl
  const parts = parentName.split('-').filter(Boolean);
  const project = parts.length > 0 ? parts[parts.length - 1] : parentName;
  return {
    project,
    sessionId: basename(filePath, '.jsonl'),
    isSubagentFile: false,
    subagentFileId: null,
  };
}

function inferRoleFromTools(tools: Set<string>, isSubagent: boolean): string {
  if (!isSubagent) return 'Coordinator';
  const hasEdit = tools.has('Edit') || tools.has('Write') || tools.has('MultiEdit') || tools.has('NotebookEdit');
  const hasBash = tools.has('Bash');
  const hasSearch = tools.has('Read') || tools.has('Grep') || tools.has('Glob') || tools.has('WebSearch') || tools.has('WebFetch');

  if (hasEdit && hasBash) return 'Coder';
  if (hasEdit) return 'Coder';
  if (hasBash && !hasSearch) return 'Tester';
  if (hasSearch) return 'Researcher';
  return 'Subagent';
}

export function parseClaudeCodeJsonl(content: string, filePath: string): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  const ctx = parseClaudeFileContext(filePath);
  const seenMsgIds = new Set<string>();
  const toolsSeenByAgent = new Map<string, Set<string>>();

  const lines = content.split('\n');
  let prevTimestampMs: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let rec: ClaudeRecord;
    try {
      rec = JSON.parse(line) as ClaudeRecord;
    } catch {
      continue;
    }

    const tsMs = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    const timestampMs = Number.isFinite(tsMs) ? tsMs : Date.now();

    if (rec.type !== 'assistant' || !rec.message || !rec.message.usage) {
      if (Number.isFinite(tsMs)) prevTimestampMs = tsMs;
      continue;
    }

    const sessionId = ctx.isSubagentFile ? ctx.sessionId : (rec.sessionId ?? ctx.sessionId);
    const msgId = rec.message.id ?? rec.uuid ?? `${sessionId}:${i}`;

    if (rec.message.id && seenMsgIds.has(rec.message.id)) {
      const existing = events.find((e) => e.metadata?.messageId === rec.message?.id);
      const u = rec.message.usage;
      const outTok = u.output_tokens ?? 0;
      if (existing && outTok > existing.outputTokens) {
        const inTok = u.input_tokens ?? 0;
        const cacheRead = u.cache_read_input_tokens ?? 0;
        const cacheWrite = u.cache_creation_input_tokens ?? 0;
        existing.inputTokens = inTok;
        existing.outputTokens = outTok;
        existing.cachedReadTokens = cacheRead;
        existing.cacheWriteTokens = cacheWrite;
        existing.totalTokens = inTok + outTok + cacheRead + cacheWrite;
        const cost = estimateEventCost({
          model: existing.model,
          provider: 'anthropic',
          inputTokens: inTok,
          outputTokens: outTok,
          cachedReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
        });
        existing.estimatedCostUsd = cost.estimatedCostUsd;
        existing.cacheSavingsUsd = cost.cacheSavingsUsd;
      }
      continue;
    }
    if (rec.message.id) seenMsgIds.add(rec.message.id);

    const usage = rec.message.usage;
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cachedReadTokens = usage.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens + cachedReadTokens + cacheWriteTokens;

    if (totalTokens === 0) continue;

    const model = rec.message.model ?? 'claude-sonnet-4-6';
    const isSubagent = Boolean(ctx.isSubagentFile || rec.isSidechain || rec.agentId);
    const subId = ctx.subagentFileId ?? rec.agentId ?? 'worker';
    const rootAgentId = `${sessionId}:coordinator`;
    const agentId = isSubagent ? `${sessionId}:subagent:${subId}` : rootAgentId;

    const toolNames: string[] = [];
    if (Array.isArray(rec.message.content)) {
      for (const block of rec.message.content) {
        if (block.type === 'tool_use' && block.name) {
          toolNames.push(block.name);
        }
      }
    }

    let agentTools = toolsSeenByAgent.get(agentId);
    if (!agentTools) {
      agentTools = new Set();
      toolsSeenByAgent.set(agentId, agentTools);
    }
    for (const t of toolNames) agentTools.add(t);

    const durationMs =
      prevTimestampMs !== null && timestampMs >= prevTimestampMs && timestampMs - prevTimestampMs < 120_000
        ? Math.max(150, timestampMs - prevTimestampMs)
        : Math.max(400, Math.min(18_000, outputTokens * 18));

    const cost = estimateEventCost({
      model,
      provider: 'anthropic',
      inputTokens,
      outputTokens,
      cachedReadTokens,
      cacheWriteTokens,
    });

    const primaryTool = toolNames[0] ?? null;
    const eventId = `claude:${sessionId}:${subId}:${rec.uuid ?? msgId}:${i}`;

    events.push({
      id: eventId,
      source: 'claude-code',
      isSimulated: false,
      workflowId: `claude:${sessionId}`,
      workflowName: `Claude Code · ${ctx.project}`,
      agentId,
      agentName: isSubagent ? `Subagent · ${subId.slice(0, 7)}` : 'Claude Coordinator',
      agentRole: isSubagent ? 'Subagent' : 'Coordinator',
      parentSpanId: rec.parentUuid ?? null,
      parentAgentId: isSubagent ? rootAgentId : null,
      kind: primaryTool ? 'tool' : 'llm',
      operation: primaryTool ? `tool:${primaryTool}` : 'chat.turn',
      toolName: primaryTool,
      provider: cost.provider,
      model,
      inputTokens,
      outputTokens,
      cachedReadTokens,
      cacheWriteTokens,
      reasoningTokens: 0,
      totalTokens,
      estimatedCostUsd: cost.estimatedCostUsd,
      cacheSavingsUsd: cost.cacheSavingsUsd,
      costSource: cost.costSource,
      startTimeMs: timestampMs - durationMs,
      endTimeMs: timestampMs,
      durationMs,
      status: 'ok',
      project: ctx.project,
      metadata: {
        messageId: rec.message.id,
        tools: toolNames,
      },
    });

    prevTimestampMs = timestampMs;
  }

  // Refine subagent roles & display names once we know all tools each subagent used
  for (const ev of events) {
    if (ev.parentAgentId) {
      const role = inferRoleFromTools(toolsSeenByAgent.get(ev.agentId) ?? new Set(), true);
      ev.agentRole = role;
      const shortId = ev.agentId.split(':').pop()?.slice(0, 6) ?? 'sub';
      ev.agentName = `${role} (${shortId})`;
    }
  }

  return events;
}

export function readClaudeCodeFile(filePath: string): TelemetryEvent[] {
  const content = readFileSync(filePath, 'utf8');
  return parseClaudeCodeJsonl(content, filePath);
}
