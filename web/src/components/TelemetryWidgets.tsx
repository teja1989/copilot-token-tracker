import { formatTokens } from '../api';
import type { DashboardMetrics, TimeSeriesBucket } from '../types';

interface Props {
  kpis: DashboardMetrics['kpis'];
  timeSeries: TimeSeriesBucket[];
}

function RadialRing({
  value,
  max = 100,
  label,
  sublabel,
  color,
}: {
  value: number;
  max?: number;
  label: string;
  sublabel: string;
  color: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const r = 34;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-24 w-24">
        <svg className="h-24 w-24 -rotate-90" viewBox="0 0 84 84">
          <circle
            cx="42"
            cy="42"
            r={r}
            fill="none"
            stroke="var(--bg-muted)"
            strokeWidth="7"
          />
          <circle
            cx="42"
            cy="42"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-base font-bold text-[var(--text-primary)]">
            {Math.round(pct)}%
          </span>
        </div>
      </div>
      <div className="mt-1.5 text-xs font-semibold text-[var(--text-primary)]">{label}</div>
      <div className="text-[11px] text-[var(--text-muted)]">{sublabel}</div>
    </div>
  );
}

export function TelemetryWidgets({ kpis, timeSeries }: Props) {
  const totalTok = Math.max(1, kpis.totalTokens);
  const segments = [
    { label: 'Cached Read', value: kpis.cachedReadTokens, color: '#10b981' },
    { label: 'Uncached Input', value: kpis.inputTokens, color: '#2563eb' },
    { label: 'Output', value: kpis.outputTokens, color: '#6366f1' },
    { label: 'Reasoning', value: kpis.reasoningTokens, color: '#f59e0b' },
  ].filter((s) => s.value > 0);

  // Activity Heatmap cells (up to last 28 buckets)
  const heatBuckets = timeSeries.slice(-28);
  const maxHeat = Math.max(1, ...heatBuckets.map((b) => b.totalTokens));

  const reliabilityPct = Math.round((1 - kpis.errorRate) * 100);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Radial Performance Gauges Widget */}
      <div className="m-card rounded-2xl p-5 lg:col-span-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Performance Rings</h3>
            <p className="text-xs text-[var(--text-muted)]">Live health across cache, reliability & efficiency</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1">
          <RadialRing
            value={kpis.efficiencyScore}
            label="Efficiency"
            sublabel="Composite"
            color="#2563eb"
          />
          <RadialRing
            value={Math.round(kpis.cacheHitRate * 100)}
            label="Cache Hit"
            sublabel="Prompt reuse"
            color="#10b981"
          />
          <RadialRing
            value={reliabilityPct}
            label="Success Rate"
            sublabel="Span health"
            color="#6366f1"
          />
        </div>
      </div>

      {/* Token Composition & Activity Pulse Heatmap Widget */}
      <div className="m-card flex flex-col justify-between rounded-2xl p-5 lg:col-span-7">
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Token Composition</h3>
              <p className="text-xs text-[var(--text-muted)]">
                Exact proportion of prompt cache reuse vs new input & generation
              </p>
            </div>
            <span className="m-pill rounded-full px-2.5 py-0.5 font-mono text-xs font-medium">
              {formatTokens(kpis.totalTokens)} total
            </span>
          </div>

          {/* Material Stacked Pill Bar */}
          <div className="mt-3.5 flex h-4 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
            {segments.map((seg) => {
              const pct = (seg.value / totalTok) * 100;
              return (
                <div
                  key={seg.label}
                  style={{ width: `${Math.max(1.5, pct)}%`, backgroundColor: seg.color }}
                  title={`${seg.label}: ${formatTokens(seg.value)} (${pct.toFixed(1)}%)`}
                  className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
                />
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            {segments.map((seg) => (
              <div key={seg.label} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                <span className="text-[var(--text-secondary)]">{seg.label}</span>
                <span className="font-mono font-medium text-[var(--text-primary)]">
                  {formatTokens(seg.value)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Pulse Heatmap */}
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Activity Intensity Strip</span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Hover blocks for bucket token volume
            </span>
          </div>
          {heatBuckets.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)]">Waiting for activity buckets...</div>
          ) : (
            <div className="grid grid-cols-14 gap-1.5 sm:grid-cols-28">
              {heatBuckets.map((b) => {
                const ratio = b.totalTokens / maxHeat;
                const opacity = Math.max(0.15, Math.min(1, ratio));
                return (
                  <div
                    key={b.timestampMs}
                    title={`${b.label}: ${formatTokens(b.totalTokens)} tokens (${b.requests} calls)`}
                    style={{ backgroundColor: `rgba(37, 99, 235, ${opacity})` }}
                    className="h-6 rounded-md transition-transform hover:scale-110"
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
