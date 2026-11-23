import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FolderGit2, Search, X } from 'lucide-react';
import { formatTokens, formatUsd } from '../api';
import type { ProjectUsageSummary } from '../types';

const TOP_N = 8;
const BAR_PALETTE = ['#2563eb', '#10b981', '#6366f1', '#0ea5e9', '#f59e0b', '#ec4899', '#8b5cf6', '#64748b'];

interface Props {
  projects: ProjectUsageSummary[];
}

function formatRelativeTime(ms: number): string {
  if (!ms) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function ProjectBreakdown({ projects }: Props) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.totalTokens - a.totalTokens),
    [projects]
  );

  const totalOrgTokens = useMemo(
    () => sortedProjects.reduce((acc, p) => acc + p.totalTokens, 0),
    [sortedProjects]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedProjects;
    return sortedProjects.filter((p) => p.project.toLowerCase().includes(q));
  }, [sortedProjects, query]);

  const visible = useMemo(() => {
    if (showAll || query.trim().length > 0) return filtered;
    return filtered.slice(0, TOP_N);
  }, [filtered, showAll, query]);

  const maxVisibleTokens = useMemo(
    () => Math.max(1, ...visible.map((p) => p.totalTokens)),
    [visible]
  );

  const hasHidden = !query.trim() && filtered.length > TOP_N;

  return (
    <div className="m-card rounded-2xl p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <div className="m-subtle flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--accent-primary)]">
            <FolderGit2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Repository &amp; Project Usage</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Token share, prompt cache hit rate, workflows, and active agents per repository
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56 sm:flex-initial">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter repositories..."
              aria-label="Filter repositories"
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] py-1.5 pr-7 pl-8 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear repository search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <span className="m-pill shrink-0 rounded-full px-2.5 py-1 font-mono text-xs">
            {filtered.length === projects.length
              ? `${projects.length} ${projects.length === 1 ? 'repo' : 'repos'}`
              : `${filtered.length}/${projects.length}`}
          </span>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="py-10 text-center text-xs text-[var(--text-muted)]">
          No repository attribution recorded yet.
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-xs text-[var(--text-muted)]">
          No repositories matching <span className="font-mono text-[var(--text-primary)]">&ldquo;{query}&rdquo;</span>.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="pb-2.5 pr-3 font-medium">Repository</th>
                  <th className="min-w-[200px] pb-2.5 pr-4 font-medium">Token Share</th>
                  <th className="pb-2.5 pr-3 font-medium">Cache Hit</th>
                  <th className="pb-2.5 pr-3 text-right font-medium">Workflows</th>
                  <th className="pb-2.5 pr-3 text-right font-medium">Agents</th>
                  <th className="pb-2.5 pr-3 text-right font-medium">Est. Cost</th>
                  <th className="pb-2.5 text-right font-medium">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {visible.map((p, idx) => {
                  const sharePct = totalOrgTokens > 0 ? (p.totalTokens / totalOrgTokens) * 100 : 0;
                  const barPct = Math.max(2, Math.round((p.totalTokens / maxVisibleTokens) * 100));
                  const cachePct = Math.round(p.cacheHitRate * 100);
                  const barColor = BAR_PALETTE[idx % BAR_PALETTE.length];

                  return (
                    <tr key={p.project} className="transition-colors hover:bg-[var(--bg-subtle)]">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: barColor }}
                          />
                          <span
                            className="max-w-[220px] truncate font-mono font-medium text-[var(--text-primary)]"
                            title={p.project}
                          >
                            {p.project}
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2.5">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${barPct}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <div className="flex shrink-0 items-baseline gap-1.5 font-mono">
                            <span className="font-medium text-[var(--text-primary)]">
                              {formatTokens(p.totalTokens)}
                            </span>
                            <span className="w-10 text-right text-[11px] text-[var(--text-muted)]">
                              {sharePct < 0.1 && sharePct > 0 ? '<0.1%' : `${sharePct.toFixed(1)}%`}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-14 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${cachePct}%` }}
                            />
                          </div>
                          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                            {cachePct}%
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 pr-3 text-right font-mono text-[var(--text-secondary)]">
                        {p.workflows}
                      </td>

                      <td className="py-2.5 pr-3 text-right font-mono text-[var(--text-secondary)]">
                        {p.agents}
                      </td>

                      <td className="py-2.5 pr-3 text-right font-mono text-[var(--text-secondary)]">
                        {formatUsd(p.estimatedCostUsd)}
                      </td>

                      <td className="py-2.5 text-right font-mono text-[11px] text-[var(--text-muted)]">
                        {formatRelativeTime(p.lastSeenMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasHidden && (
            <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
              <span className="text-[11px] text-[var(--text-muted)]">
                Showing {showAll ? filtered.length : Math.min(TOP_N, filtered.length)} of {filtered.length} repositories
              </span>
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                className="m-pill flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition hover:opacity-90"
              >
                {showAll ? (
                  <>
                    Show top {TOP_N}
                    <ChevronUp className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    Show all ({filtered.length})
                    <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
