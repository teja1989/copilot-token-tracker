import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { TelemetryEvent } from '../model/types.js';
import { estimateEventCost } from '../pricing/estimator.js';

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    model?: string;
    info?: {
      last_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
      };
    };
  };
}

export function parseCodexJsonl(content: string, filePath: string): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  const sessionId = basename(filePath, '.jsonl');
  const lines = content.split('\n');
  let currentModel = 'gpt-5.3-codex';
  let prevTsMs: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec: CodexLine;
    try {
      rec = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }

    if (rec.payload?.model) {
      currentModel = rec.payload.model;
    }

    const usage = rec.payload?.info?.last_token_usage;
    if (!usage) continue;

    const inputTokens = Math.max(0, usage.input_tokens ?? 0);
    const cachedReadTokens = Math.max(0, usage.cached_input_tokens ?? 0);
    const outputTokens = Math.max(0, usage.output_tokens ?? 0);
    const reasoningTokens = Math.max(0, usage.reasoning_output_tokens ?? 0);
    const totalTokens = inputTokens + cachedReadTokens + outputTokens + reasoningTokens;
    if (totalTokens === 0) continue;

    const tsMs = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    const timestampMs = Number.isFinite(tsMs) ? tsMs : Date.now();
    const durationMs =
      prevTsMs !== null && timestampMs >= prevTsMs && timestampMs - prevTsMs < 120_000
        ? Math.max(200, timestampMs - prevTsMs)
        : 1500;

    const cost = estimateEventCost({
      model: currentModel,
      provider: 'openai',
      inputTokens,
      outputTokens,
      cachedReadTokens,
      reasoningTokens,
    });

    events.push({
      id: `codex:${sessionId}:${i}`,
      source: 'codex',
      isSimulated: false,
      workflowId: `codex:${sessionId}`,
      workflowName: `Codex CLI · ${sessionId.slice(0, 8)}`,
      agentId: `codex:${sessionId}:agent`,
      agentName: 'Codex Agent',
      agentRole: 'Coder',
      kind: 'llm',
      operation: 'codex.turn',
      provider: cost.provider,
      model: currentModel,
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
      status: 'ok',
      project: 'Codex CLI',
    });

    prevTsMs = timestampMs;
  }

  return events;
}

export function readCodexFile(filePath: string): TelemetryEvent[] {
  const content = readFileSync(filePath, 'utf8');
  return parseCodexJsonl(content, filePath);
}
