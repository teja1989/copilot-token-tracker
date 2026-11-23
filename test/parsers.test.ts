import { describe, expect, it } from 'vitest';
import { parseAntigravityTranscript } from '../src/ingest/antigravity.js';
import { parseClaudeCodeJsonl } from '../src/ingest/claudeCode.js';
import { parseCodexJsonl } from '../src/ingest/codex.js';
import { COPILOT_ROLLUP_AGENT, mapCopilotTraceRow, parseCopilotChatSessionJson } from '../src/ingest/copilot.js';
import { normalizeSimpleIngest, parseOtlpTraces } from '../src/ingest/otlp.js';

describe('Multi-Source Parsers', () => {
  it('excludes GitHub Copilot Chat aggregate rollup rows to avoid double counting', () => {
    const rollup = mapCopilotTraceRow({
      span_id: 's1',
      conversation_id: 'c1',
      agent_name: COPILOT_ROLLUP_AGENT,
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(rollup).toBeNull();

    const child = mapCopilotTraceRow({
      span_id: 's2',
      conversation_id: 'c1',
      agent_name: 'Copilot Edits',
      request_model: 'gpt-5.4',
      input_tokens: 1000,
      output_tokens: 500,
      cached_tokens: 2000,
      start_time_ms: 1000,
      end_time_ms: 2500,
    });
    expect(child).not.toBeNull();
    expect(child!.source).toBe('copilot');
    expect(child!.totalTokens).toBe(3500);
    expect(child!.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('parses VS Code Copilot chatSessions JSON', () => {
    const raw = JSON.stringify({
      sessionId: 'sess-1',
      customTitle: 'Fix Auth',
      requests: [
        {
          requestId: 'req-1',
          timestamp: 1700000000000,
          modelId: 'copilot/gpt-4.1',
          agent: { id: 'workspace', name: 'Workspace' },
          message: { text: 'Explain auth middleware' },
          response: [{ value: 'Here is how auth middleware works...' }],
          result: { timings: { totalElapsed: 1100 }, metadata: { promptTokens: 420, completionTokens: 180 } },
        },
      ],
    });
    const events = parseCopilotChatSessionJson(raw, '/tmp/sess-1.json');
    expect(events).toHaveLength(1);
    expect(events[0].model).toBe('gpt-4.1');
    expect(events[0].inputTokens).toBe(420);
  });

  it('parses Claude Code JSONL including subagents and prompt caching', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        uuid: 'u1',
        sessionId: 's-claude',
        timestamp: '2026-11-20T10:00:00.000Z',
        isSidechain: false,
        message: {
          id: 'm1',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, cache_read_input_tokens: 12000, cache_creation_input_tokens: 2000, output_tokens: 300 },
          content: [{ type: 'tool_use', id: 't1', name: 'Read' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'u2',
        parentUuid: 'u1',
        sessionId: 's-claude',
        timestamp: '2026-11-20T10:00:05.000Z',
        isSidechain: true,
        agentId: 'sub123',
        message: {
          id: 'm2',
          model: 'claude-haiku-4.5',
          usage: { input_tokens: 500, cache_read_input_tokens: 1000, output_tokens: 200 },
        },
      }),
    ].join('\n');

    const events = parseClaudeCodeJsonl(lines, '/Users/dev/.claude/projects/-Users-dev-myapp/s-claude.jsonl');
    expect(events).toHaveLength(2);
    expect(events[0].project).toBe('myapp');
    expect(events[0].toolName).toBe('Read');
    expect(events[1].agentRole).toBe('Subagent');
    expect(events[1].parentAgentId).toBe(events[0].agentId);
  });

  it('links nested Claude Code subagent files into the parent workflow and infers role', () => {
    const subLine = JSON.stringify({
      type: 'assistant',
      uuid: 'sub-u1',
      timestamp: '2026-11-20T10:01:00.000Z',
      message: {
        id: 'sub-m1',
        model: 'claude-haiku-4-5',
        usage: { input_tokens: 400, cache_read_input_tokens: 3000, output_tokens: 250 },
        content: [{ type: 'tool_use', id: 't2', name: 'Grep' }],
      },
    });
    const events = parseClaudeCodeJsonl(
      subLine,
      '/Users/dev/.claude/projects/-Users-dev-CortexGaming/sess-99/subagents/agent-a9211cc.jsonl',
    );
    expect(events).toHaveLength(1);
    expect(events[0].workflowId).toBe('claude:sess-99');
    expect(events[0].project).toBe('CortexGaming');
    expect(events[0].parentAgentId).toBe('sess-99:coordinator');
    expect(events[0].agentRole).toBe('Researcher');
  });

  it('parses Antigravity transcript JSONL and emits subagent handoff spans', () => {
    const line = JSON.stringify({
      step_index: 1,
      created_at: '2026-11-23T15:00:00.000Z',
      model: 'gemini-4',
      input_tokens: 2500,
      cache_read_tokens: 14000,
      output_tokens: 600,
      tool_calls: [{ name: 'invoke_subagent', arguments: { Role: 'Codebase Researcher' } }],
    });
    const events = parseAntigravityTranscript(line, '/home/.gemini/antigravity/brain/conv-abc/.system_generated/logs/transcript.jsonl');
    expect(events).toHaveLength(2);
    expect(events[0].source).toBe('antigravity');
    expect(events[1].kind).toBe('handoff');
    expect(events[1].parentAgentId).toBe(events[0].agentId);
  });

  it('parses Codex CLI JSONL', () => {
    const line = JSON.stringify({
      timestamp: '2026-11-23T12:00:00.000Z',
      payload: {
        model: 'gpt-5.3-codex',
        info: { last_token_usage: { input_tokens: 3000, cached_input_tokens: 8000, output_tokens: 900, reasoning_output_tokens: 400 } },
      },
    });
    const events = parseCodexJsonl(line, '/home/.codex/sessions/run1.jsonl');
    expect(events).toHaveLength(1);
    expect(events[0].reasoningTokens).toBe(400);
    expect(events[0].totalTokens).toBe(12300);
  });

  it('parses OpenTelemetry OTLP/JSON traces and simple SDK ingest payloads', () => {
    const otlp = parseOtlpTraces({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'langgraph-app' } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'trace-1',
                  spanId: 'sp-1',
                  name: 'chat',
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000002000000000',
                  attributes: [
                    { key: 'gen_ai.request.model', value: { stringValue: 'gpt-5.4' } },
                    { key: 'gen_ai.usage.input_tokens', value: { intValue: 2000 } },
                    { key: 'gen_ai.usage.output_tokens', value: { intValue: 500 } },
                    { key: 'gen_ai.agent.name', value: { stringValue: 'Planner' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(otlp).toHaveLength(1);
    expect(otlp[0].source).toBe('otlp');
    expect(otlp[0].durationMs).toBe(2000);

    const sdk = normalizeSimpleIngest({ model: 'gemini-3-flash', inputTokens: 1000, outputTokens: 200 });
    expect(sdk).toHaveLength(1);
    expect(sdk[0].source).toBe('sdk');
    expect(sdk[0].totalTokens).toBe(1200);
  });
});
