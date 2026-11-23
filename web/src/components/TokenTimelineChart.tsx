import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTokens } from '../api';
import type { TimeSeriesBucket } from '../types';

interface Props {
  data: TimeSeriesBucket[];
}

export function TokenTimelineChart({ data }: Props) {
  const [view, setView] = useState<'tokens' | 'requests'>('tokens');

  return (
    <div className="m-card rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Token Throughput Timeline</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Cached reads, uncached input, output generation, and reasoning tokens over time
          </p>
        </div>
        <div className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5 text-xs">
          <button
            onClick={() => setView('tokens')}
            className={`rounded-lg px-3 py-1 font-medium transition ${
              view === 'tokens'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Tokens
          </button>
          <button
            onClick={() => setView('requests')}
            className={`rounded-lg px-3 py-1 font-medium transition ${
              view === 'requests'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Requests
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex h-60 items-center justify-center text-xs text-[var(--text-muted)]">
          No telemetry events in selected range.
        </div>
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {view === 'tokens' ? (
              <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid-line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatTokens} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                    boxShadow: 'var(--card-shadow)',
                  }}
                  formatter={(value: number, name: string) => [formatTokens(value), name]}
                />
                <Area type="monotone" dataKey="cachedReadTokens" name="Cached Read" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.22} strokeWidth={2} />
                <Area type="monotone" dataKey="inputTokens" name="Uncached Input" stackId="1" stroke="#2563eb" fill="#2563eb" fillOpacity={0.22} strokeWidth={2} />
                <Area type="monotone" dataKey="outputTokens" name="Output" stackId="1" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} />
                <Area type="monotone" dataKey="reasoningTokens" name="Reasoning" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.22} strokeWidth={2} />
              </AreaChart>
            ) : (
              <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid-line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="requests" name="Spans" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
