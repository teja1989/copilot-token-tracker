import { Activity, Cpu, Gauge, Layers, Sparkles } from 'lucide-react';
import { formatDuration, formatTokens, formatUsd } from '../api';
import type { DashboardMetrics } from '../types';

interface Props {
  kpis: DashboardMetrics['kpis'];
}

export function KpiStrip({ kpis }: Props) {
  const cards = [
    {
      label: 'Total Tokens',
      value: formatTokens(kpis.totalTokens),
      detail: `${formatTokens(kpis.inputTokens)} in · ${formatTokens(kpis.outputTokens)} out`,
      icon: Cpu,
      chipBg: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Cache Hit Rate',
      value: `${Math.round(kpis.cacheHitRate * 100)}%`,
      detail: `${formatTokens(kpis.cachedReadTokens)} cached · ${formatUsd(kpis.cacheSavingsUsd)} saved`,
      icon: Sparkles,
      chipBg: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Agents & Workflows',
      value: `${kpis.uniqueAgents} / ${kpis.totalWorkflows}`,
      detail: `${kpis.totalRequests.toLocaleString()} spans captured`,
      icon: Layers,
      chipBg: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400',
    },
    {
      label: 'Latency (Avg / p95)',
      value: formatDuration(kpis.avgLatencyMs),
      detail: `p95 ${formatDuration(kpis.p95LatencyMs)} · ${(kpis.errorRate * 100).toFixed(1)}% err`,
      icon: Gauge,
      chipBg: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Health Score',
      value: `${kpis.efficiencyScore}/100`,
      detail: `Ref spend ${formatUsd(kpis.totalCostUsd)}`,
      icon: Activity,
      chipBg: 'bg-teal-500/12 text-teal-600 dark:text-teal-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="m-card m-card-lift rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-muted)]">{c.label}</span>
              <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${c.chipBg}`}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 font-mono text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {c.value}
            </div>
            <div className="mt-1 truncate text-xs text-[var(--text-muted)]" title={c.detail}>
              {c.detail}
            </div>
          </div>
        );
      })}
    </div>
  );
}
