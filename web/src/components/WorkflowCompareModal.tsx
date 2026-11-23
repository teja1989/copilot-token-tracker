import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, GitCompare, Loader2, X } from 'lucide-react';
import { fetchWorkflowGraph, formatDuration, formatTokens, formatUsd } from '../api';
import type { WorkflowGraphDetail, WorkflowRunSummary } from '../types';

interface Props {
  workflows: WorkflowRunSummary[];
  onClose: () => void;
}

type DeltaTone = 'better' | 'worse' | 'neutral';

interface DeltaBadge {
  label: string;
  tone: DeltaTone;
}

interface MetricRow {
  key: string;
  label: string;
  valA: number;
  valB: number;
  displayA: string;
  displayB: string;
  delta: DeltaBadge;
}

function pctDeltaBadge(
  a: number,
  b: number,
  unit: string,
  lowerIsBetter: boolean
): DeltaBadge {
  if (a === 0 && b === 0) return { label: 'Same', tone: 'neutral' };
  if (a === 0) {
    return {
      label: `+${unit}`,
      tone: lowerIsBetter ? 'worse' : 'better',
    };
  }
  const pct = ((b - a) / a) * 100;
  if (Math.abs(pct) < 0.5) return { label: 'Same', tone: 'neutral' };
  const sign = pct > 0 ? '+' : '';
  const better = lowerIsBetter ? pct < 0 : pct > 0;
  return {
    label: `${sign}${Math.round(pct)}% ${unit}`,
    tone: better ? 'better' : 'worse',
  };
}

function durationDeltaBadge(aMs: number, bMs: number): DeltaBadge {
  if (aMs <= 0 && bMs <= 0) return { label: 'Same', tone: 'neutral' };
  if (aMs <= 0 || bMs <= 0) return { label: 'N/A', tone: 'neutral' };
  const ratio = aMs / bMs;
  if (Math.abs(ratio - 1) < 0.05) return { label: 'Same speed', tone: 'neutral' };
  if (bMs < aMs) {
    return { label: `${ratio.toFixed(1)}x faster`, tone: 'better' };
  }
  return { label: `${(bMs / aMs).toFixed(1)}x slower`, tone: 'worse' };
}

function ppDeltaBadge(aRate: number, bRate: number, higherIsBetter: boolean): DeltaBadge {
  const diffPp = Math.round((bRate - aRate) * 100);
  if (diffPp === 0) return { label: 'Same', tone: 'neutral' };
  const sign = diffPp > 0 ? '+' : '';
  const better = higherIsBetter ? diffPp > 0 : diffPp < 0;
  return {
    label: `${sign}${diffPp}pp`,
    tone: better ? 'better' : 'worse',
  };
}

function factorDeltaBadge(a: number, b: number, higherIsBetter: boolean): DeltaBadge {
  const diff = b - a;
  if (Math.abs(diff) < 0.05) return { label: 'Same', tone: 'neutral' };
  const sign = diff > 0 ? '+' : '';
  const better = higherIsBetter ? diff > 0 : diff < 0;
  return {
    label: `${sign}${diff.toFixed(1)}x`,
    tone: better ? 'better' : 'worse',
  };
}

function countDeltaBadge(a: number, b: number, singular: string, plural: string): DeltaBadge {
  const diff = b - a;
  if (diff === 0) return { label: 'Same', tone: 'neutral' };
  const sign = diff > 0 ? '+' : '';
  const unit = Math.abs(diff) === 1 ? singular : plural;
  return { label: `${sign}${diff} ${unit}`, tone: 'neutral' };
}

function badgeClasses(tone: DeltaTone): string {
  if (tone === 'better') {
    return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  }
  if (tone === 'worse') {
    return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  }
  return 'm-pill';
}

function workflowOptionLabel(w: WorkflowRunSummary): string {
  const tokens = formatTokens(w.totalTokens);
  const dur = formatDuration(w.durationMs);
  return `${w.workflowName} · ${tokens} · ${dur}`;
}

export function WorkflowCompareModal({ workflows, onClose }: Props) {
  const [runAId, setRunAId] = useState<string>(() => workflows[0]?.workflowId ?? '');
  const [runBId, setRunBId] = useState<string>(
    () => workflows[1]?.workflowId ?? workflows[0]?.workflowId ?? ''
  );

  const [graphA, setGraphA] = useState<WorkflowGraphDetail | null>(null);
  const [graphB, setGraphB] = useState<WorkflowGraphDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!runAId || !runBId) {
      setGraphA(null);
      setGraphB(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (runAId === runBId) {
          const single = await fetchWorkflowGraph(runAId);
          if (!cancelled) {
            setGraphA(single);
            setGraphB(single);
          }
        } else {
          const [a, b] = await Promise.all([
            fetchWorkflowGraph(runAId),
            fetchWorkflowGraph(runBId),
          ]);
          if (!cancelled) {
            setGraphA(a);
            setGraphB(b);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workflow graphs.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [runAId, runBId]);

  const metricRows = useMemo<MetricRow[]>(() => {
    if (!graphA || !graphB) return [];

    const wfA = graphA.workflow;
    const wfB = graphB.workflow;
    const colA = graphA.collaboration;
    const colB = graphB.collaboration;

    const agentsA = wfA.agentCount || graphA.nodes.length;
    const agentsB = wfB.agentCount || graphB.nodes.length;

    return [
      {
        key: 'tokens',
        label: 'Total Tokens',
        valA: wfA.totalTokens,
        valB: wfB.totalTokens,
        displayA: formatTokens(wfA.totalTokens),
        displayB: formatTokens(wfB.totalTokens),
        delta: pctDeltaBadge(wfA.totalTokens, wfB.totalTokens, 'tokens', true),
      },
      {
        key: 'cacheHit',
        label: 'Prompt Cache Hit %',
        valA: wfA.cacheHitRate * 100,
        valB: wfB.cacheHitRate * 100,
        displayA: `${Math.round(wfA.cacheHitRate * 100)}%`,
        displayB: `${Math.round(wfB.cacheHitRate * 100)}%`,
        delta: ppDeltaBadge(wfA.cacheHitRate, wfB.cacheHitRate, true),
      },
      {
        key: 'duration',
        label: 'Wall Duration',
        valA: wfA.durationMs,
        valB: wfB.durationMs,
        displayA: formatDuration(wfA.durationMs),
        displayB: formatDuration(wfB.durationMs),
        delta: durationDeltaBadge(wfA.durationMs, wfB.durationMs),
      },
      {
        key: 'agents',
        label: 'Active Agents',
        valA: agentsA,
        valB: agentsB,
        displayA: String(agentsA),
        displayB: String(agentsB),
        delta: countDeltaBadge(agentsA, agentsB, 'agent', 'agents'),
      },
      {
        key: 'parallelism',
        label: 'Parallelism Factor',
        valA: colA.parallelismFactor,
        valB: colB.parallelismFactor,
        displayA: `${colA.parallelismFactor.toFixed(2)}x`,
        displayB: `${colB.parallelismFactor.toFixed(2)}x`,
        delta: factorDeltaBadge(colA.parallelismFactor, colB.parallelismFactor, true),
      },
      {
        key: 'depth',
        label: 'Delegation Depth',
        valA: colA.maxDelegationDepth,
        valB: colB.maxDelegationDepth,
        displayA: `${colA.maxDelegationDepth}`,
        displayB: `${colB.maxDelegationDepth}`,
        delta: countDeltaBadge(colA.maxDelegationDepth, colB.maxDelegationDepth, 'hop', 'hops'),
      },
      {
        key: 'handoffs',
        label: 'Total Handoffs',
        valA: colA.totalHandoffs,
        valB: colB.totalHandoffs,
        displayA: String(colA.totalHandoffs),
        displayB: String(colB.totalHandoffs),
        delta: countDeltaBadge(colA.totalHandoffs, colB.totalHandoffs, 'handoff', 'handoffs'),
      },
      {
        key: 'toolSuccess',
        label: 'Tool Success %',
        valA: colA.toolSuccessRate * 100,
        valB: colB.toolSuccessRate * 100,
        displayA: `${Math.round(colA.toolSuccessRate * 100)}%`,
        displayB: `${Math.round(colB.toolSuccessRate * 100)}%`,
        delta: ppDeltaBadge(colA.toolSuccessRate, colB.toolSuccessRate, true),
      },
    ];
  }, [graphA, graphB]);

  const modelsDelta = useMemo<DeltaBadge>(() => {
    if (!graphA || !graphB) return { label: '—', tone: 'neutral' };
    const setA = new Set(graphA.workflow.models);
    const setB = new Set(graphB.workflow.models);
    const same = setA.size === setB.size && [...setA].every((m) => setB.has(m));
    if (same) return { label: 'Same models', tone: 'neutral' };
    const diff = setB.size - setA.size;
    if (diff === 0) return { label: 'Swapped models', tone: 'neutral' };
    const sign = diff > 0 ? '+' : '';
    return {
      label: `${sign}${diff} ${Math.abs(diff) === 1 ? 'model' : 'models'}`,
      tone: 'neutral',
    };
  }, [graphA, graphB]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-card flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--border-subtle)] px-6 py-4">
          <div className="flex items-start gap-2.5">
            <div className="m-subtle flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--accent-primary)]">
              <GitCompare className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Compare Workflow Runs</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Side-by-side token efficiency, cache hit rate, latency, and multi-agent collaboration deltas (Run B vs Run A)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comparison modal"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">
          {workflows.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--text-muted)]">
              No workflow runs available to compare.
            </div>
          ) : (
            <>
              {/* Selectors */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="m-subtle rounded-xl p-3">
                  <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                    Run A (Baseline)
                  </label>
                  <select
                    value={runAId}
                    onChange={(e) => setRunAId(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  >
                    {workflows.map((w) => (
                      <option key={w.workflowId} value={w.workflowId}>
                        {workflowOptionLabel(w)}
                      </option>
                    ))}
                  </select>
                  {graphA && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <span className="m-pill rounded-full px-2 py-0.5 capitalize">{graphA.workflow.source}</span>
                      {graphA.workflow.project && (
                        <span className="m-pill max-w-[160px] truncate rounded-full px-2 py-0.5 font-mono">
                          {graphA.workflow.project}
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[var(--text-secondary)]">
                        {formatUsd(graphA.workflow.estimatedCostUsd)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="m-subtle rounded-xl p-3">
                  <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                    Run B (Comparison)
                  </label>
                  <select
                    value={runBId}
                    onChange={(e) => setRunBId(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  >
                    {workflows.map((w) => (
                      <option key={w.workflowId} value={w.workflowId}>
                        {workflowOptionLabel(w)}
                      </option>
                    ))}
                  </select>
                  {graphB && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <span className="m-pill rounded-full px-2 py-0.5 capitalize">{graphB.workflow.source}</span>
                      {graphB.workflow.project && (
                        <span className="m-pill max-w-[160px] truncate rounded-full px-2 py-0.5 font-mono">
                          {graphB.workflow.project}
                        </span>
                      )}
                      <span className="ml-auto font-mono text-[var(--text-secondary)]">
                        {formatUsd(graphB.workflow.estimatedCostUsd)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Loading / Error / Comparison Table */}
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-14 text-xs text-[var(--text-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-primary)]" />
                  Loading workflow telemetry graphs...
                </div>
              ) : error ? (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : graphA && graphB ? (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="pb-2.5 pr-3 font-medium">Metric</th>
                        <th className="pb-2.5 pr-3 text-right font-medium">Run A</th>
                        <th className="min-w-[180px] pb-2.5 px-3 font-medium">Visual Comparison</th>
                        <th className="pb-2.5 pl-3 text-right font-medium">Run B</th>
                        <th className="pb-2.5 pl-4 text-right font-medium">Delta (B vs A)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {metricRows.map((row) => {
                        const maxVal = Math.max(row.valA, row.valB, 0.0001);
                        const pctA = row.valA > 0 ? Math.max(3, Math.round((row.valA / maxVal) * 100)) : 0;
                        const pctB = row.valB > 0 ? Math.max(3, Math.round((row.valB / maxVal) * 100)) : 0;

                        return (
                          <tr key={row.key} className="hover:bg-[var(--bg-subtle)]">
                            <td className="py-3 pr-3 font-medium text-[var(--text-primary)]">
                              {row.label}
                            </td>
                            <td className="py-3 pr-3 text-right font-mono text-[var(--text-secondary)]">
                              {row.displayA}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex flex-col gap-1">
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
                                  <div
                                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                                    style={{ width: `${pctA}%` }}
                                  />
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
                                  <div
                                    className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                                    style={{ width: `${pctB}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="py-3 pl-3 text-right font-mono font-medium text-[var(--text-primary)]">
                              {row.displayB}
                            </td>
                            <td className="py-3 pl-4 text-right">
                              <span
                                className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium ${badgeClasses(
                                  row.delta.tone
                                )}`}
                              >
                                {row.delta.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}

                      {/* Models Used row */}
                      <tr className="hover:bg-[var(--bg-subtle)]">
                        <td className="py-3 pr-3 align-top font-medium text-[var(--text-primary)]">
                          Models Used
                        </td>
                        <td className="py-3 pr-3 align-top text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {graphA.workflow.models.length > 0 ? (
                              graphA.workflow.models.map((m) => (
                                <span
                                  key={m}
                                  className="m-pill rounded-full px-2 py-0.5 font-mono text-[10.5px]"
                                >
                                  {m}
                                </span>
                              ))
                            ) : (
                              <span className="text-[var(--text-muted)]">—</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top text-center text-[11px] text-[var(--text-muted)]">
                          {graphA.workflow.models.length} vs {graphB.workflow.models.length}
                        </td>
                        <td className="py-3 pl-3 align-top text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {graphB.workflow.models.length > 0 ? (
                              graphB.workflow.models.map((m) => (
                                <span
                                  key={m}
                                  className="m-pill rounded-full px-2 py-0.5 font-mono text-[10.5px]"
                                >
                                  {m}
                                </span>
                              ))
                            ) : (
                              <span className="text-[var(--text-muted)]">—</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pl-4 align-top text-right">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium ${badgeClasses(
                              modelsDelta.tone
                            )}`}
                          >
                            {modelsDelta.label}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
