import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { TelemetryEvent } from '../model/types.js';
import { estimateEventCost } from '../pricing/estimator.js';

interface AntigravityToolCall {
  name?: string;
  id?: string;
  arguments?: Record<string, unknown>;
}

interface AntigravityLine {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  model?: string;
  input_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  content?: string;
  tool_calls?: AntigravityToolCall[];
}

export interface AntigravityParentLink {
  parentWorkflowId: string;
  parentWorkflowName: string;
  parentAgentId: string;
  role: string;
}

export function extractAntigravityConvId(filePath: string): string {
  // Path: ~/.gemini/antigravity/brain/<conversationId>/.system_generated/logs/transcript.jsonl
  const logsDir = dirname(filePath);
  const sysDir = dirname(logsDir);
  return basename(dirname(sysDir)) || 'antigravity-session';
}

/**
 * Scans a parent transcript for `invoke_subagent` calls and matches returned
 * conversationIds in subsequent tool results so child transcripts can be linked
 * directly into the parent's multi-agent DAG.
 */
export function discoverAntigravityChildLinks(
  content: string,
  filePath: string,
): Map<string, AntigravityParentLink> {
  const links = new Map<string, AntigravityParentLink>();
  const convId = extractAntigravityConvId(filePath);
  const parentWorkflowId = `antigravity:${convId}`;
  const parentWorkflowName = `Antigravity · ${convId.slice(0, 8)}`;
  const parentAgentId = `${parentWorkflowId}:coordinator`;

  const lines = content.split('\n');
  let lastRole = 'Subagent';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let rec: AntigravityLine;
    try {
      rec = JSON.parse(line) as AntigravityLine;
    } catch {
      continue;
    }

    if (Array.isArray(rec.tool_calls)) {
      for (const tc of rec.tool_calls) {
        if (tc.name === 'invoke_subagent') {
          if (typeof tc.arguments?.Role === 'string' && tc.arguments.Role.trim()) {
            lastRole = tc.arguments.Role.trim();
          } else if (typeof tc.arguments?.TypeName === 'string' && tc.arguments.TypeName.trim()) {
            lastRole = tc.arguments.TypeName.trim();
          }
        }
      }
    }

    if (typeof rec.content === 'string' && rec.content.includes('conversationId')) {
      const matches = rec.content.matchAll(/"conversationId"\s*:\s*"([a-f0-9-]{8,})"/gi);
      for (const m of matches) {
        const childConvId = m[1];
        if (childConvId && childConvId !== convId) {
          links.set(childConvId, {
            parentWorkflowId,
            parentWorkflowName,
            parentAgentId,
            role: lastRole,
          });
        }
      }
    }
  }

  return links;
}

export function parseAntigravityTranscript(
  content: string,
  filePath: string,
  parentLink?: AntigravityParentLink,
): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  const convId = extractAntigravityConvId(filePath);

  const workflowId = parentLink ? parentLink.parentWorkflowId : `antigravity:${convId}`;
  const workflowName = parentLink ? parentLink.parentWorkflowName : `Antigravity · ${convId.slice(0, 8)}`;
  const agentId = parentLink ? `${workflowId}:sub:${convId.slice(0, 8)}` : `${workflowId}:coordinator`;
  const agentName = parentLink ? parentLink.role : 'Antigravity Coordinator';
  const agentRole = parentLink ? inferAgRole(parentLink.role) : 'Coordinator';

  const lines = content.split('\n');
  let prevTsMs: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let rec: AntigravityLine;
    try {
      rec = JSON.parse(line) as AntigravityLine;
    } catch {
      continue;
    }

    const tsMs = rec.created_at ? Date.parse(rec.created_at) : NaN;
    const timestampMs = Number.isFinite(tsMs) ? tsMs : Date.now();

    const inputTokens = Math.max(0, Number(rec.input_tokens ?? 0) || 0);
    const cachedReadTokens = Math.max(0, Number(rec.cache_read_tokens ?? 0) || 0);
    const outputTokens = Math.max(0, Number(rec.output_tokens ?? 0) || 0);
    const reasoningTokens = Math.max(0, Number(rec.reasoning_tokens ?? 0) || 0);
    const totalTokens = inputTokens + cachedReadTokens + outputTokens + reasoningTokens;

    if (totalTokens === 0 && (!rec.tool_calls || rec.tool_calls.length === 0)) {
      if (Number.isFinite(tsMs)) prevTsMs = tsMs;
      continue;
    }

    const model = rec.model?.trim() || 'gemini-4';
    const durationMs =
      prevTsMs !== null && timestampMs >= prevTsMs && timestampMs - prevTsMs < 180_000
        ? Math.max(200, timestampMs - prevTsMs)
        : Math.max(500, Math.min(20_000, outputTokens * 12));

    const cost = estimateEventCost({
      model,
      provider: 'google',
      inputTokens,
      outputTokens,
      cachedReadTokens,
      reasoningTokens,
    });

    const toolCalls = Array.isArray(rec.tool_calls) ? rec.tool_calls : [];
    const primaryTool = toolCalls[0]?.name ?? null;
    const isError = rec.status === 'error' || rec.status === 'failed';

    const spanId = `antigravity:${convId}:step:${rec.step_index ?? i}`;
    events.push({
      id: spanId,
      source: 'antigravity',
      isSimulated: false,
      workflowId,
      workflowName,
      agentId,
      agentName,
      agentRole,
      parentAgentId: parentLink ? parentLink.parentAgentId : null,
      kind: primaryTool ? 'tool' : 'llm',
      operation: primaryTool ? `tool:${primaryTool}` : 'agent.turn',
      toolName: primaryTool,
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
      costSource: cost.costSource,
      startTimeMs: timestampMs - durationMs,
      endTimeMs: timestampMs,
      durationMs,
      status: isError ? 'error' : 'ok',
      project: 'Antigravity',
      metadata: {
        stepIndex: rec.step_index,
        toolCount: toolCalls.length,
        tools: toolCalls.map((t) => t.name).filter(Boolean),
      },
    });

    // If no linked child transcript exists yet, still emit delegation handoff markers
    if (!parentLink) {
      for (let j = 0; j < toolCalls.length; j++) {
        const tc = toolCalls[j];
        if (tc.name === 'invoke_subagent' || tc.name === 'swarm') {
          const role =
            typeof tc.arguments?.Role === 'string'
              ? tc.arguments.Role
              : typeof tc.arguments?.TypeName === 'string'
                ? tc.arguments.TypeName
                : typeof tc.arguments?.name === 'string'
                  ? tc.arguments.name
                  : 'Subagent';
          const subId = `${workflowId}:sub:${role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          events.push({
            id: `${spanId}:handoff:${j}`,
            source: 'antigravity',
            isSimulated: false,
            workflowId,
            workflowName,
            agentId: subId,
            agentName: role,
            agentRole: inferAgRole(role),
            parentSpanId: spanId,
            parentAgentId: agentId,
            kind: 'handoff',
            operation: `delegate:${role}`,
            toolName: tc.name,
            provider: cost.provider,
            model,
            inputTokens: 0,
            outputTokens: 0,
            cachedReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            cacheSavingsUsd: 0,
            costSource: 'catalog-estimate',
            startTimeMs: timestampMs,
            endTimeMs: timestampMs + 50,
            durationMs: 50,
            status: 'ok',
            project: 'Antigravity',
          });
        }
      }
    }

    prevTsMs = timestampMs;
  }

  return events;
}

function inferAgRole(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes('verif') || lower.includes('test') || lower.includes('qa')) return 'Tester';
  if (lower.includes('research') || lower.includes('explore') || lower.includes('browser')) return 'Researcher';
  if (lower.includes('review') || lower.includes('audit')) return 'Reviewer';
  if (lower.includes('plan') || lower.includes('architect')) return 'Planner';
  if (lower.includes('code') || lower.includes('dev') || lower.includes('eng')) return 'Coder';
  return 'Subagent';
}

export function readAntigravityTranscriptFile(
  filePath: string,
  parentLink?: AntigravityParentLink,
): TelemetryEvent[] {
  const content = readFileSync(filePath, 'utf8');
  return parseAntigravityTranscript(content, filePath, parentLink);
}
