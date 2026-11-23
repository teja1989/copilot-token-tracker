import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, Sparkles } from 'lucide-react';
import { formatTokens } from '../api';
import type { EfficiencyInsight } from '../types';

interface Props {
  insights: EfficiencyInsight[];
}

const BORDER_ACCENT: Record<EfficiencyInsight['severity'], string> = {
  high: 'border-l-rose-500',
  medium: 'border-l-amber-500',
  low: 'border-l-blue-500',
  positive: 'border-l-emerald-500',
};

export function EfficiencyInsights({ insights }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalRecoverable = insights.reduce((sum, i) => sum + (i.recoverableTokens ?? 0), 0);

  return (
    <div className="m-card rounded-2xl p-5">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Token-Burn & Agent Diagnostics
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Pinpoints context snowballs, tool loops, cache-busting agents, and prompt stuffing
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalRecoverable > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/12 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <Sparkles className="h-3 w-3" />
              ~{formatTokens(totalRecoverable)} tok recoverable
            </span>
          )}
          <span className="m-pill rounded-full px-2.5 py-0.5 font-mono text-[11px]">
            {insights.length} signals
          </span>
        </div>
      </div>

      {insights.length === 0 ? (
        <div className="m-subtle rounded-xl p-4 text-xs text-[var(--text-muted)]">
          No token-burn anomalies detected. Your agents look well-bounded and cache-efficient.
        </div>
      ) : (
        <div className="space-y-2.5">
          {insights.map((item) => {
            const isOpen = expandedId === item.id;
            return (
              <div
                key={item.id}
                className={`m-subtle rounded-xl border-l-4 p-3.5 ${BORDER_ACCENT[item.severity]}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    {item.severity === 'positive' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : item.severity === 'high' ? (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                    ) : (
                      <Info className="h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    <span>{item.title}</span>
                  </div>

                  {item.recoverableTokens && item.recoverableTokens > 0 ? (
                    <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-blue-600 dark:text-blue-400">
                      ~{formatTokens(item.recoverableTokens)} tok recoverable
                    </span>
                  ) : null}
                </div>

                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">{item.description}</p>
                <p className="mt-1.5 text-[11.5px] font-medium text-[var(--text-primary)]">
                  → {item.recommendation}
                </p>

                {(item.evidence || (item.affectedAgents && item.affectedAgents.length > 0)) && (
                  <div className="mt-2">
                    <button
                      onClick={() => setExpandedId(isOpen ? null : item.id)}
                      className="flex items-center gap-1 font-mono text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      How this was derived
                    </button>
                    {isOpen && (
                      <div className="mt-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                        {item.evidence && <div>{item.evidence}</div>}
                        {item.affectedAgents && item.affectedAgents.length > 0 && (
                          <div className="mt-1 text-[var(--text-muted)]">
                            Affected agents: {item.affectedAgents.join(', ')}
                          </div>
                        )}
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
