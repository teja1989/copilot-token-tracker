import type { EfficiencyInsight, TelemetryEvent } from '../model/types.js';
import { matchModelRate } from '../pricing/catalog.js';

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function generateEfficiencyInsights(events: TelemetryEvent[]): EfficiencyInsight[] {
  if (events.length === 0) return [];
  const insights: EfficiencyInsight[] = [];

  // Group spans by workflow -> agent for realistic per-agent & per-workflow analysis
  const byWorkflow = new Map<string, TelemetryEvent[]>();
  const byAgentKey = new Map<string, { name: string; spans: TelemetryEvent[] }>();

  for (const ev of events) {
    const wfList = byWorkflow.get(ev.workflowId);
    if (wfList) wfList.push(ev);
    else byWorkflow.set(ev.workflowId, [ev]);

    const agKey = `${ev.workflowId}::${ev.agentId}`;
    const ag = byAgentKey.get(agKey);
    if (ag) ag.spans.push(ev);
    else byAgentKey.set(agKey, { name: ev.agentName, spans: [ev] });
  }

  // 1. Context Snowball Detector (per-agent monotonic context growth without compaction)
  const snowballFindings: Array<{
    agentName: string;
    startCtx: number;
    peakCtx: number;
    turns: number;
    excessTokens: number;
  }> = [];

  for (const { name, spans } of byAgentKey.values()) {
    if (spans.length < 5) continue;
    const sorted = [...spans].sort((a, b) => a.startTimeMs - b.startTimeMs);
    const contexts = sorted
      .map((s) => s.inputTokens + s.cachedReadTokens)
      .filter((c) => c > 0);
    if (contexts.length < 5) continue;

    const startCtx = contexts[0];
    const peakCtx = Math.max(...contexts);
    const growthRatio = peakCtx / Math.max(1000, startCtx);

    if (peakCtx >= 60_000 && growthRatio >= 2.2) {
      // Estimate tokens recoverable if context had been compacted/capped around 45K
      const excessTokens = contexts.reduce((sum, c) => sum + Math.max(0, c - 45_000), 0);
      snowballFindings.push({
        agentName: name,
        startCtx,
        peakCtx,
        turns: contexts.length,
        excessTokens,
      });
    }
  }

  if (snowballFindings.length > 0) {
    snowballFindings.sort((a, b) => b.excessTokens - a.excessTokens);
    const top = snowballFindings[0];
    const totalRecoverable = snowballFindings.reduce((s, f) => s + f.excessTokens, 0);
    insights.push({
      id: 'context-snowball',
      severity: totalRecoverable > 500_000 || top.peakCtx > 120_000 ? 'high' : 'medium',
      category: 'orchestration',
      title: `Context snowball in ${top.agentName} (${fmtTok(top.startCtx)} → ${fmtTok(top.peakCtx)})`,
      description: `${snowballFindings.length} agent run(s) grew context monotonically without compaction. ${top.agentName} reached ${fmtTok(top.peakCtx)} tokens/turn across ${top.turns} turns.`,
      recommendation:
        'Enable automatic history compaction after 8–10 turns, cap tool outputs (e.g., max 200 lines from grep/file reads), or delegate heavy exploration to short-lived subagents.',
      evidence: `Peak ${fmtTok(top.peakCtx)} vs initial ${fmtTok(top.startCtx)} (${(top.peakCtx / Math.max(1, top.startCtx)).toFixed(1)}× growth); ${fmtTok(totalRecoverable)} tokens spent above 45K/turn baseline.`,
      recoverableTokens: Math.round(totalRecoverable * 0.6),
      affectedAgents: Array.from(new Set(snowballFindings.map((f) => f.agentName))).slice(0, 4),
    });
  }

  // 2. Tool-Call Thrashing / Silent Loop Detector (3+ consecutive identical tool calls)
  let loopClusters = 0;
  let loopTokens = 0;
  const loopingAgents = new Set<string>();
  const loopingTools = new Set<string>();

  for (const { name, spans } of byAgentKey.values()) {
    const sorted = [...spans].sort((a, b) => a.startTimeMs - b.startTimeMs);
    let streakTool: string | null = null;
    let streakSpans: TelemetryEvent[] = [];

    const flushStreak = () => {
      if (streakTool && streakSpans.length >= 3) {
        loopClusters++;
        loopingAgents.add(name);
        loopingTools.add(streakTool);
        // Tokens burned after the 2nd repeat are likely wasted thrashing
        loopTokens += streakSpans.slice(2).reduce((s, e) => s + e.totalTokens, 0);
      }
      streakTool = null;
      streakSpans = [];
    };

    for (const sp of sorted) {
      if (sp.toolName && sp.toolName === streakTool) {
        streakSpans.push(sp);
      } else {
        flushStreak();
        if (sp.toolName) {
          streakTool = sp.toolName;
          streakSpans = [sp];
        }
      }
    }
    flushStreak();
  }

  if (loopClusters > 0 && loopTokens > 5_000) {
    insights.push({
      id: 'tool-thrashing-loops',
      severity: loopTokens > 150_000 || loopClusters >= 4 ? 'high' : 'medium',
      category: 'reliability',
      title: `${loopClusters} repeated tool-call loop(s) burned ${fmtTok(loopTokens)} tokens`,
      description: `Agents (${Array.from(loopingAgents).slice(0, 3).join(', ')}) called ${Array.from(loopingTools).slice(0, 3).join(', ')} 3+ times consecutively in the same workflow.`,
      recommendation:
        'Batch file reads/searches into single calls, return clearer error messages from custom tools, and enforce a max-consecutive-retry guardrail (e.g., stop after 2 identical tool calls).',
      evidence: `Detected ${loopClusters} streak(s) of ≥3 identical consecutive tool calls; counted tokens from call #3 onward in each streak.`,
      recoverableTokens: loopTokens,
      affectedAgents: Array.from(loopingAgents).slice(0, 4),
    });
  }

  // 3. Per-Agent Prompt Cache-Busting Audit
  const cacheBusters: Array<{ agentName: string; cacheHitRate: number; uncachedTokens: number; turns: number }> = [];
  for (const { name, spans } of byAgentKey.values()) {
    if (spans.length < 4) continue;
    const uncached = spans.reduce((s, e) => s + e.inputTokens, 0);
    const cached = spans.reduce((s, e) => s + e.cachedReadTokens, 0);
    const promptTotal = uncached + cached;
    if (promptTotal < 25_000) continue;
    const rate = cached / promptTotal;
    if (rate < 0.2) {
      cacheBusters.push({ agentName: name, cacheHitRate: rate, uncachedTokens: uncached, turns: spans.length });
    }
  }

  if (cacheBusters.length > 0) {
    cacheBusters.sort((a, b) => b.uncachedTokens - a.uncachedTokens);
    const worst = cacheBusters[0];
    const totalUncached = cacheBusters.reduce((s, c) => s + c.uncachedTokens, 0);
    insights.push({
      id: 'per-agent-cache-busting',
      severity: totalUncached > 200_000 ? 'high' : 'medium',
      category: 'caching',
      title: `Cache-busting detected in ${worst.agentName} (${Math.round(worst.cacheHitRate * 100)}% hit rate)`,
      description: `${cacheBusters.length} agent run(s) sent ${fmtTok(totalUncached)} uncached input tokens with <20% prompt cache reuse.`,
      recommendation:
        'Keep system instructions, repo summaries, and tool definitions static at the top of the prompt—avoid injecting current timestamps, random IDs, or dynamic RAG chunks before static instructions.',
      evidence: `Checked agents with ≥4 turns and ≥25K prompt tokens; ${worst.agentName} had ${fmtTok(worst.uncachedTokens)} uncached tokens over ${worst.turns} turns.`,
      recoverableTokens: Math.round(totalUncached * 0.65),
      affectedAgents: Array.from(new Set(cacheBusters.map((c) => c.agentName))).slice(0, 4),
    });
  }

  // 4. Uncached Input Stuffing (High Uncached Input-to-Output Ratio)
  const stuffers: Array<{ agentName: string; ratio: number; avgInput: number; uncachedTotal: number }> = [];
  for (const { name, spans } of byAgentKey.values()) {
    if (spans.length < 3) continue;
    const uncached = spans.reduce((s, e) => s + e.inputTokens, 0);
    const output = spans.reduce((s, e) => s + e.outputTokens, 0);
    const avgInput = uncached / spans.length;
    if (output > 0 && avgInput >= 3_000 && uncached / output >= 25) {
      stuffers.push({ agentName: name, ratio: uncached / output, avgInput, uncachedTotal: uncached });
    }
  }

  if (stuffers.length > 0) {
    stuffers.sort((a, b) => b.uncachedTotal - a.uncachedTotal);
    const worst = stuffers[0];
    const recoverable = Math.round(stuffers.reduce((s, x) => s + x.uncachedTotal, 0) * 0.5);
    insights.push({
      id: 'prompt-output-stuffing',
      severity: worst.ratio >= 50 ? 'high' : 'medium',
      category: 'orchestration',
      title: `Heavy uncached prompt stuffing in ${worst.agentName} (${Math.round(worst.ratio)}:1 in/out)`,
      description: `${worst.agentName} averages ${fmtTok(worst.avgInput)} uncached input tokens per turn for small outputs—typically caused by dumping whole files, raw logs, or oversized JSON blobs into prompts.`,
      recommendation:
        'Trim tool responses before returning them to the LLM (pass line ranges, diffs, or structured summaries instead of full files/logs).',
      evidence: `Uncached input/output ratio ${worst.ratio.toFixed(1)}:1 across ≥3 turns (threshold ≥25:1, avg uncached ≥3K/turn).`,
      recoverableTokens: recoverable,
      affectedAgents: Array.from(new Set(stuffers.map((s) => s.agentName))).slice(0, 4),
    });
  }

  // 5. Hard Error Spans (Wasted Tokens on Failed Calls)
  const errors = events.filter((e) => e.status === 'error');
  if (errors.length >= 2) {
    const errorRate = errors.length / events.length;
    const wastedTokens = errors.reduce((s, e) => s + e.totalTokens, 0);
    const agents = Array.from(new Set(errors.map((e) => e.agentName)));
    insights.push({
      id: 'agent-error-retries',
      severity: errorRate > 0.1 ? 'high' : 'medium',
      category: 'reliability',
      title: `${errors.length} failed spans (${(errorRate * 100).toFixed(1)}% error rate)`,
      description: `Agents (${agents.slice(0, 3).join(', ')}) failed on ${errors.length} turns, burning ${fmtTok(wastedTokens)} tokens on unsuccessful execution.`,
      recommendation:
        'Validate tool arguments before execution and cap retry loops with clear error feedback so agents fail fast instead of burning tokens.',
      evidence: `${errors.length} of ${events.length} spans returned status=error (${fmtTok(wastedTokens)} tokens consumed).`,
      recoverableTokens: wastedTokens,
      affectedAgents: agents.slice(0, 4),
    });
  }

  // 6. Smart Model Routing (Strictly excludes tool-calling turns & large-context reasoning!)
  const trivialFrontierTurns = events.filter((e) => {
    const rate = matchModelRate(e.model);
    return (
      rate?.tier === 'frontier' &&
      !e.toolName &&
      e.kind === 'llm' &&
      e.inputTokens < 4_000 &&
      e.outputTokens > 0 &&
      e.outputTokens < 200
    );
  });

  if (trivialFrontierTurns.length >= 5) {
    const tokens = trivialFrontierTurns.reduce((s, e) => s + e.totalTokens, 0);
    const models = Array.from(new Set(trivialFrontierTurns.map((e) => e.model)));
    insights.push({
      id: 'frontier-on-trivial-turns',
      severity: 'low',
      category: 'cost',
      title: `${trivialFrontierTurns.length} lightweight non-tool turns used frontier models`,
      description: `${models.join(', ')} handled ${trivialFrontierTurns.length} short-context, short-output chat turns (${fmtTok(tokens)} tokens).`,
      recommendation:
        'Route lightweight routing, formatting, and short Q&A steps in custom agents to fast-tier models (e.g., gemini-3-flash, claude-haiku-4.5, gpt-5-mini) to preserve frontier quota.',
      evidence: `Filtered strictly to non-tool LLM turns with <4K uncached input and <200 output tokens (excludes coding tool calls).`,
      recoverableTokens: Math.round(tokens * 0.7),
      affectedModels: models,
    });
  }

  // 7. Positive Health Signal: Strong Prompt Cache Reuse
  const totalInputSide = events.reduce((s, e) => s + e.inputTokens + e.cachedReadTokens, 0);
  const totalCached = events.reduce((s, e) => s + e.cachedReadTokens, 0);
  const cacheRate = totalInputSide > 0 ? totalCached / totalInputSide : 0;

  if (totalCached >= 50_000 && cacheRate >= 0.45) {
    insights.push({
      id: 'strong-cache-savings',
      severity: 'positive',
      category: 'caching',
      title: `Strong prompt cache reuse (${Math.round(cacheRate * 100)}% · ${fmtTok(totalCached)} cached)`,
      description: `${fmtTok(totalCached)} of ${fmtTok(totalInputSide)} prompt tokens were served from cache, dramatically reducing quota burn.`,
      recommendation: 'Keep static system instructions and tool schemas pinned at the prefix of custom agents.',
      evidence: `Cached read tokens (${fmtTok(totalCached)}) / Total prompt-side tokens (${fmtTok(totalInputSide)}) = ${(cacheRate * 100).toFixed(1)}%.`,
    });
  }

  return insights;
}
