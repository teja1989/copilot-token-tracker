import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatDuration, formatTokens } from '../api';
import type { ModelUsageSummary } from '../types';

const PALETTE = ['#2563eb', '#10b981', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#64748b'];

interface Props {
  models: ModelUsageSummary[];
}

export function ModelBreakdown({ models }: Props) {
  const pieData = models.slice(0, 7).map((m) => ({
    name: m.model,
    value: m.totalTokens,
  }));

  return (
    <div className="m-card rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Model Attribution</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Token share, prompt cache efficiency, and p95 latency per model
          </p>
        </div>
        <span className="m-pill rounded-full px-2.5 py-0.5 font-mono text-xs">
          {models.length} models
        </span>
      </div>

      {models.length === 0 ? (
        <div className="py-10 text-center text-xs text-[var(--text-muted)]">No model calls recorded.</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="h-52 lg:col-span-3">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={78}
                  paddingAngle={3}
                  stroke="var(--bg-surface)"
                  strokeWidth={2}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                  }}
                  formatter={(v: number) => [formatTokens(v), 'Tokens']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto lg:col-span-9">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="pb-2.5 pr-3 font-medium">Model</th>
                  <th className="pb-2.5 pr-3 font-medium">Provider</th>
                  <th className="pb-2.5 pr-3 font-medium">Calls</th>
                  <th className="pb-2.5 pr-3 font-medium">Tokens</th>
                  <th className="pb-2.5 pr-3 font-medium">Cache Hit</th>
                  <th className="pb-2.5 text-right font-medium">p95 Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {models.map((m, idx) => (
                  <tr key={m.model} className="hover:bg-[var(--bg-subtle)]">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                        />
                        <span className="font-mono font-medium text-[var(--text-primary)]">{m.model}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="m-pill rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize">
                        {m.provider}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-[var(--text-secondary)]">{m.requests}</td>
                    <td className="py-2.5 pr-3 font-mono font-medium text-[var(--text-primary)]">
                      {formatTokens(m.totalTokens)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.round(m.cacheHitRate * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                          {Math.round(m.cacheHitRate * 100)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-mono text-[var(--text-muted)]">
                      {formatDuration(m.p95LatencyMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
