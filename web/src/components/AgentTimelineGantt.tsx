import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Cpu,
  Filter,
  Layers,
  ListOrdered,
  Wrench,
} from 'lucide-react';
import { formatDuration, formatTokens } from '../api';
import type { TelemetryEvent, WorkflowGraphDetail } from '../types';

interface Props {
  graph: WorkflowGraphDetail;
}

const ROLE_COLOR: Record<string, { bar: string; dot: string; text: string }> = {
  Coordinator: { bar: '#2563eb', dot: 'bg-blue-600', text: 'text-blue-600 dark:text-blue-400' },
  Planner: { bar: '#7c3aed', dot: 'bg-violet-600', text: 'text-violet-600 dark:text-violet-400' },
  Researcher: { bar: '#0284c7', dot: 'bg-sky-500', text: 'text-sky-600 dark:text-sky-400' },
  Coder: { bar: '#059669', dot: 'bg-emerald-600', text: 'text-emerald-600 dark:text-emerald-400' },
  Reviewer: { bar: '#d97706', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  Tester: { bar: '#db2777', dot: 'bg-pink-600', text: 'text-pink-600 dark:text-pink-400' },
  Subagent: { bar: '#64748b', dot: 'bg-slate-500', text: 'text-slate-600 dark:text-slate-400' },
};

const DEFAULT_ROLE = { bar: '#64748b', dot: 'bg-slate-500', text: 'text-slate-500' };

export function AgentTimelineGantt({ graph }: Props) {
  const { workflow, nodes, spans } = graph;

  const [viewMode, setViewMode] = useState<'trace' | 'grouped'>('trace');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'tool' | 'llm' | 'error'>('all');
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    // Expand first 2 agents by default in grouped view
    nodes.slice(0, 2).forEach((n) => {
      init[n.agentId] = true;
    });
    return init;
  });
  const [visibleCount, setVisibleCount] = useState(25);

  const filteredSpans = useMemo(() => {
    return spans.filter((sp) => {
      if (agentFilter !== 'all' && sp.agentId !== agentFilter) return false;
      if (kindFilter === 'tool' && !sp.toolName && sp.kind !== 'tool') return false;
      if (kindFilter === 'llm' && (sp.toolName || sp.kind === 'tool')) return false;
      if (kindFilter === 'error' && sp.status !== 'error') return false;
      return true;
    });
  }, [spans, agentFilter, kindFilter]);

  // Compute compressed active timeline offsets so idle gaps (e.g. user stepped away for 2 hours)
  // never crush real turns into unreadable 1px slivers.
  const compressed = useMemo(() => {
    if (filteredSpans.length === 0) {
      return { totalMs: 1000, maxDurationMs: 1000, items: [] as Array<{ span: TelemetryEvent; offsetMs: number; gapBeforeMs: number }> };
    }
    const maxDurationMs = Math.max(100, ...filteredSpans.map((s) => s.durationMs));
    let cursorMs = 0;
    let prevEndMs = filteredSpans[0].startTimeMs;
    const items: Array<{ span: TelemetryEvent; offsetMs: number; gapBeforeMs: number }> = [];

    for (const sp of filteredSpans) {
      const rawGap = sp.startTimeMs - prevEndMs;
      // If there's a real idle gap > 30s, compress it to a small visual break
      const gapBeforeMs = rawGap > 30_000 ? rawGap : 0;
      if (rawGap > 0) {
        cursorMs += Math.min(rawGap, 1500);
      } else if (rawGap < 0) {
        // Overlapping parallel execution: step back slightly to show overlap
        cursorMs = Math.max(0, cursorMs - Math.min(Math.abs(rawGap), sp.durationMs * 0.6));
      }
      items.push({ span: sp, offsetMs: cursorMs, gapBeforeMs });
      cursorMs += Math.max(150, sp.durationMs);
      prevEndMs = Math.max(prevEndMs, sp.endTimeMs);
    }

    return { totalMs: Math.max(500, cursorMs), maxDurationMs, items };
  }, [filteredSpans]);

  const activeRoles = useMemo(
    () => Array.from(new Set(nodes.map((n) => n.agentRole))),
    [nodes],
  );

  const toggleAgent = (agentId: string) => {
    setExpandedAgents((prev) => ({ ...prev, [agentId]: !prev[agentId] }));
  };

  return (
    <div className="m-card rounded-2xl p-5">
      {/* Header & View Switcher */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Execution Trace Waterfall</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Step-by-step timeline with idle-gap compression · click any span to inspect token & timing details
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5 text-xs">
            <button
              onClick={() => setViewMode('trace')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                viewMode === 'trace'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              Trace Steps
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
                viewMode === 'grouped'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              By Agent
            </button>
          </div>
        </div>
      </div>

      {/* Filter Bar & Role Legend */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--border-subtle)] py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <Filter className="h-3.5 w-3.5" />
            <select
              value={agentFilter}
              onChange={(e) => {
                setAgentFilter(e.target.value);
                setVisibleCount(25);
              }}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Agents ({nodes.length})</option>
              {nodes.map((n) => (
                <option key={n.agentId} value={n.agentId}>
                  {n.agentName} ({n.calls})
                </option>
              ))}
            </select>
          </div>

          <div className="flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5 text-[11px]">
            {(['all', 'tool', 'llm', 'error'] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKindFilter(k);
                  setVisibleCount(25);
                }}
                className={`rounded-md px-2 py-0.5 capitalize transition ${
                  kindFilter === k
                    ? 'bg-[var(--bg-surface)] font-semibold text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {k === 'all' ? `All (${spans.length})` : k}
              </button>
            ))}
          </div>
        </div>

        {/* Clean Role Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)]">
          {activeRoles.map((role) => {
            const style = ROLE_COLOR[role] ?? DEFAULT_ROLE;
            return (
              <span key={role} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                {role}
              </span>
            );
          })}
          <span className="font-mono text-[var(--text-secondary)]">
            Wall: {formatDuration(workflow.durationMs)}
          </span>
        </div>
      </div>

      {/* VIEW 1: Clean Step-by-Step Trace Waterfall (Jaeger / DevTools style) */}
      {viewMode === 'trace' && (
        <div className="mt-3">
          {filteredSpans.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--text-muted)]">
              No spans match the current filter.
            </div>
          ) : (
            <>
              {/* Column Headers */}
              <div className="grid grid-cols-12 items-center gap-3 px-2.5 pb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                <div className="col-span-5 sm:col-span-4">Step · Agent & Action</div>
                <div className="col-span-4 sm:col-span-5">Duration & Sequence</div>
                <div className="col-span-3 text-right">Tokens / Time</div>
              </div>

              <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                {compressed.items.slice(0, visibleCount).map(({ span: sp, offsetMs, gapBeforeMs }, idx) => {
                  const style = ROLE_COLOR[sp.agentRole] ?? DEFAULT_ROLE;
                  const isError = sp.status === 'error';
                  const isExpanded = expandedSpanId === sp.id;
                  const leftPct = Math.min(88, (offsetMs / compressed.totalMs) * 100);
                  const widthPct = Math.max(
                    3,
                    Math.min(100 - leftPct, (sp.durationMs / compressed.totalMs) * 100),
                  );
                  const cachePct =
                    sp.inputTokens + sp.cachedReadTokens > 0
                      ? Math.round((sp.cachedReadTokens / (sp.inputTokens + sp.cachedReadTokens)) * 100)
                      : 0;

                  return (
                    <div key={sp.id}>
                      {gapBeforeMs > 0 && (
                        <div className="flex items-center gap-2 bg-[var(--bg-subtle)] px-3 py-1 text-[10px] font-mono text-[var(--text-muted)]">
                          <span className="h-px flex-1 border-t border-dashed border-[var(--border-strong)]" />
                          <span>idle gap ({formatDuration(gapBeforeMs)})</span>
                          <span className="h-px flex-1 border-t border-dashed border-[var(--border-strong)]" />
                        </div>
                      )}

                      <div
                        onClick={() => setExpandedSpanId(isExpanded ? null : sp.id)}
                        className="grid cursor-pointer grid-cols-12 items-center gap-3 px-2.5 py-2 transition hover:bg-[var(--bg-subtle)]"
                      >
                        {/* Left: Step #, Role dot, Agent, Operation */}
                        <div className="col-span-5 flex min-w-0 items-center gap-2 sm:col-span-4">
                          <span className="w-6 shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                            #{idx + 1}
                          </span>
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${isError ? 'bg-rose-500' : style.dot}`}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                {sp.agentName}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                              {isError ? (
                                <AlertCircle className="h-3 w-3 shrink-0 text-rose-500" />
                              ) : sp.toolName ? (
                                <Wrench className="h-3 w-3 shrink-0 text-amber-500" />
                              ) : (
                                <Cpu className="h-3 w-3 shrink-0 text-blue-500" />
                              )}
                              <span className="truncate font-mono">{sp.toolName ?? sp.operation}</span>
                            </div>
                          </div>
                        </div>

                        {/* Middle: Clean Waterfall Bar */}
                        <div className="col-span-4 sm:col-span-5">
                          <div className="relative h-5 w-full rounded-md bg-[var(--bg-subtle)]">
                            <div
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                backgroundColor: isError ? '#e11d48' : style.bar,
                              }}
                              className="absolute top-1 bottom-1 rounded-sm transition-all"
                            />
                          </div>
                        </div>

                        {/* Right: Tokens + Duration */}
                        <div className="col-span-3 text-right font-mono">
                          <div className="text-xs font-semibold text-[var(--text-primary)]">
                            {formatTokens(sp.totalTokens)} tok
                          </div>
                          <div className="text-[10.5px] text-[var(--text-muted)]">
                            {formatDuration(sp.durationMs)}
                          </div>
                        </div>
                      </div>

                      {/* Expanded Span Details */}
                      {isExpanded && (
                        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-3 text-xs">
                          <div className="grid grid-cols-2 gap-3 font-mono sm:grid-cols-4">
                            <div>
                              <div className="text-[10px] text-[var(--text-muted)]">Model</div>
                              <div className="font-medium text-[var(--text-primary)]">{sp.model}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[var(--text-muted)]">Tokens (In / Cache / Out)</div>
                              <div>
                                <span className="text-blue-600 dark:text-blue-400">{formatTokens(sp.inputTokens)}</span>
                                {' / '}
                                <span className="text-emerald-600 dark:text-emerald-400">{formatTokens(sp.cachedReadTokens)}</span>
                                {' / '}
                                <span className="text-indigo-600 dark:text-indigo-400">{formatTokens(sp.outputTokens)}</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[var(--text-muted)]">Prompt Cache Reuse</div>
                              <div className="font-medium text-emerald-600 dark:text-emerald-400">{cachePct}%</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[var(--text-muted)]">Timestamp</div>
                              <div className="text-[var(--text-secondary)]">
                                {new Date(sp.startTimeMs).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                          {sp.errorMessage && (
                            <div className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 font-mono text-[11px] text-rose-600 dark:text-rose-400">
                              Error: {sp.errorMessage}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {filteredSpans.length > visibleCount && (
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setVisibleCount((c) => c + 40)}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-4 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
                  >
                    Show 40 more ({filteredSpans.length - visibleCount} remaining)
                  </button>
                  <button
                    onClick={() => setVisibleCount(filteredSpans.length)}
                    className="rounded-xl px-3 py-1.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Show all {filteredSpans.length}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* VIEW 2: Grouped By Agent (Collapsible Swimlanes) */}
      {viewMode === 'grouped' && (
        <div className="mt-3 space-y-2.5">
          {nodes.map((node) => {
            const agentSpans = filteredSpans.filter((s) => s.agentId === node.agentId);
            if (agentFilter !== 'all' && agentFilter !== node.agentId) return null;
            const style = ROLE_COLOR[node.agentRole] ?? DEFAULT_ROLE;
            const isOpen = Boolean(expandedAgents[node.agentId]);
            const tokenSharePct =
              workflow.totalTokens > 0 ? Math.round((node.totalTokens / workflow.totalTokens) * 100) : 0;
            const maxSpanDur = Math.max(100, ...agentSpans.map((s) => s.durationMs));

            return (
              <div
                key={node.agentId}
                className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              >
                <button
                  onClick={() => toggleAgent(node.agentId)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[var(--bg-subtle)]"
                >
                  <div className="flex items-center gap-2.5">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                    <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{node.agentName}</span>
                    <span className="m-pill rounded-full px-2 py-0.5 text-[10px] font-medium">
                      {node.agentRole}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 font-mono text-xs">
                    <span className="text-[var(--text-muted)]">{agentSpans.length} spans</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {formatTokens(node.totalTokens)} tok ({tokenSharePct}%)
                    </span>
                    <span className="text-[var(--text-muted)]">avg {formatDuration(node.avgLatencyMs)}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50">
                    {agentSpans.slice(0, 30).map((sp, i) => {
                      const barPct = Math.max(4, Math.round((sp.durationMs / maxSpanDur) * 100));
                      const isError = sp.status === 'error';
                      return (
                        <div
                          key={sp.id}
                          className="grid grid-cols-12 items-center gap-3 px-4 py-2 text-xs"
                        >
                          <div className="col-span-5 flex items-center gap-2 sm:col-span-4">
                            <span className="w-5 font-mono text-[10px] text-[var(--text-muted)]">{i + 1}.</span>
                            <span className="truncate font-mono text-[var(--text-primary)]">
                              {sp.toolName ?? sp.operation}
                            </span>
                          </div>
                          <div className="col-span-4 flex items-center gap-2 sm:col-span-5">
                            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                              <div
                                style={{
                                  width: `${barPct}%`,
                                  backgroundColor: isError ? '#e11d48' : style.bar,
                                }}
                                className="h-full rounded-full"
                              />
                            </div>
                            <span className="w-12 shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
                              {formatDuration(sp.durationMs)}
                            </span>
                          </div>
                          <div className="col-span-3 text-right font-mono text-[11px] text-[var(--text-secondary)]">
                            {formatTokens(sp.totalTokens)} tok
                          </div>
                        </div>
                      );
                    })}
                    {agentSpans.length > 30 && (
                      <div className="px-4 py-2 text-center font-mono text-[11px] text-[var(--text-muted)]">
                        Showing first 30 of {agentSpans.length} spans for this agent (switch to Trace Steps to view all)
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
