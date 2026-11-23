import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { formatDuration, formatTokens } from '../api';
import type { TelemetryEvent } from '../types';

interface Props {
  events: TelemetryEvent[];
  total: number;
}

export function LiveEventFeed({ events, total }: Props) {
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) =>
        e.model.toLowerCase().includes(q) ||
        e.agentName.toLowerCase().includes(q) ||
        e.operation.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        e.workflowName.toLowerCase().includes(q),
    );
  }, [events, query]);

  return (
    <div className="m-card rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Span Inspector</h3>
          <p className="font-mono text-xs text-[var(--text-muted)]">
            {filtered.length} shown / {total.toLocaleString()} total spans
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter model, agent, tool, source..."
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] py-1.5 pr-3 pl-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              <th className="pb-2.5 pr-3 font-medium">Time</th>
              <th className="pb-2.5 pr-3 font-medium">Source</th>
              <th className="pb-2.5 pr-3 font-medium">Agent / Operation</th>
              <th className="pb-2.5 pr-3 font-medium">Model</th>
              <th className="pb-2.5 pr-3 font-medium">Tokens (In / Cache / Out)</th>
              <th className="pb-2.5 text-right font-medium">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {filtered.slice(0, 120).map((ev) => {
              const isExpanded = expandedId === ev.id;
              return (
                <tr
                  key={ev.id}
                  onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                  className="cursor-pointer hover:bg-[var(--bg-subtle)]"
                >
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-[var(--text-muted)]">
                    {new Date(ev.endTimeMs).toLocaleTimeString()}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="m-pill rounded-full px-2 py-0.5 font-mono text-[10px] font-medium">
                      {ev.source}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1.5">
                      {ev.status === 'error' ? (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      )}
                      <span className="font-medium text-[var(--text-primary)]">{ev.agentName}</span>
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">{ev.operation}</span>
                    </div>
                    {isExpanded && (
                      <div className="m-subtle mt-2 rounded-xl p-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        <div>workflow: {ev.workflowName} ({ev.workflowId})</div>
                        <div>span: {ev.id}{ev.parentAgentId ? ` · parent: ${ev.parentAgentId}` : ''}</div>
                        {ev.errorMessage && <div className="text-rose-500">error: {ev.errorMessage}</div>}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[var(--text-secondary)]">{ev.model}</td>
                  <td className="py-2.5 pr-3 font-mono text-[11px]">
                    <span className="text-blue-600 dark:text-blue-400">{formatTokens(ev.inputTokens)}</span>
                    <span className="text-[var(--text-muted)]"> / </span>
                    <span className="text-emerald-600 dark:text-emerald-400">{formatTokens(ev.cachedReadTokens)}</span>
                    <span className="text-[var(--text-muted)]"> / </span>
                    <span className="text-indigo-600 dark:text-indigo-400">{formatTokens(ev.outputTokens)}</span>
                  </td>
                  <td className="py-2.5 text-right font-mono text-[var(--text-muted)]">
                    {formatDuration(ev.durationMs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
