import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTokens } from '../api';
import type { WorkflowGraphDetail } from '../types';

interface Props {
  graph: WorkflowGraphDetail;
}

interface ContextTurnPoint {
  step: number;
  label: string;
  contextTokens: number;
  inputTokens: number;
  cachedReadTokens: number;
  outputTokens: number;
  agentId: string;
  agentName: string;
  operation: string;
  model: string;
}

const CONTEXT_WINDOW_LIMIT = 200_000;

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ContextTurnPoint }>;
}

function ContextTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const pctWindow = Math.round((point.contextTokens / CONTEXT_WINDOW_LIMIT) * 100);

  return (
    <div
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 text-xs"
      style={{ boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-1.5">
        <span className="font-mono font-semibold text-[var(--text-primary)]">Turn {point.label}</span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{point.model}</span>
      </div>
      <div className="mt-1.5 text-[11px] font-medium text-[var(--text-primary)]">{point.agentName}</div>
      <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">{point.operation}</div>
      <div className="mt-2 space-y-1 font-mono text-[11px]">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
            Context Size
          </span>
          <span className="font-semibold text-[var(--text-primary)]">
            {formatTokens(point.contextTokens)} ({pctWindow}%)
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            Uncached Input
          </span>
          <span className="font-semibold text-[var(--text-primary)]">{formatTokens(point.inputTokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Cached Read
          </span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {formatTokens(point.cachedReadTokens)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ContextGrowthChart({ graph }: Props) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');

  const effectiveAgentId = useMemo(() => {
    if (selectedAgentId === 'all') return 'all';
    return graph.nodes.some((n) => n.agentId === selectedAgentId) ? selectedAgentId : 'all';
  }, [graph.nodes, selectedAgentId]);

  const chartData = useMemo<ContextTurnPoint[]>(() => {
    const sorted = [...graph.spans].sort((a, b) => a.startTimeMs - b.startTimeMs);
    const filtered =
      effectiveAgentId === 'all' ? sorted : sorted.filter((sp) => sp.agentId === effectiveAgentId);

    return filtered.map((sp, idx) => ({
      step: idx + 1,
      label: `#${idx + 1}`,
      contextTokens: sp.inputTokens + sp.cachedReadTokens,
      inputTokens: sp.inputTokens,
      cachedReadTokens: sp.cachedReadTokens,
      outputTokens: sp.outputTokens,
      agentId: sp.agentId,
      agentName: sp.agentName,
      operation: sp.toolName ? `${sp.operation} · ${sp.toolName}` : sp.operation,
      model: sp.model,
    }));
  }, [graph.spans, effectiveAgentId]);

  const peakContext = useMemo(
    () => chartData.reduce((max, pt) => Math.max(max, pt.contextTokens), 0),
    [chartData],
  );

  const peakPct = Math.round((peakContext / CONTEXT_WINDOW_LIMIT) * 100);
  const yMax = Math.max(215_000, Math.ceil(peakContext * 1.1));

  const peakPillClass =
    peakContext >= CONTEXT_WINDOW_LIMIT
      ? 'border border-rose-500/35 bg-rose-500/12 text-rose-600 dark:text-rose-400'
      : peakContext >= CONTEXT_WINDOW_LIMIT * 0.75
        ? 'border border-amber-500/35 bg-amber-500/12 text-amber-600 dark:text-amber-400'
        : 'm-pill';

  return (
    <div className="m-card rounded-2xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/12 text-indigo-600 dark:text-indigo-400">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Context Window Growth</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Per-turn context size (input + cached reads) vs. uncached input across chronological steps
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold ${peakPillClass}`}>
            <span>Peak {formatTokens(peakContext)}</span>
            <span className="opacity-75">({peakPct}%)</span>
          </span>

          <select
            aria-label="Filter context growth by agent"
            value={effectiveAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] outline-none transition focus:border-blue-500"
          >
            <option value="all">All Agents ({graph.nodes.length})</option>
            {graph.nodes.map((node) => (
              <option key={node.agentId} value={node.agentId}>
                {node.agentName} ({node.agentRole})
              </option>
            ))}
          </select>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex h-60 items-center justify-center text-xs text-[var(--text-muted)]">
          No turns recorded for the selected agent.
        </div>
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid-line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--text-muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
              />
              <YAxis
                stroke="var(--text-muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                domain={[0, yMax]}
                tickFormatter={formatTokens}
              />
              <Tooltip content={<ContextTooltip />} />
              <ReferenceLine
                y={CONTEXT_WINDOW_LIMIT}
                stroke="#f59e0b"
                strokeDasharray="5 4"
                strokeWidth={1.5}
                label={{
                  value: '200K window',
                  position: 'insideTopRight',
                  fill: '#d97706',
                  fontSize: 10.5,
                  fontWeight: 600,
                }}
              />
              <Area
                type="monotone"
                dataKey="contextTokens"
                name="Context Size"
                stroke="#6366f1"
                fill="#6366f1"
                fillOpacity={0.2}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="inputTokens"
                name="Uncached Input"
                stroke="#2563eb"
                fill="#2563eb"
                fillOpacity={0.22}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
