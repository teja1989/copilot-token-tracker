import type {
  DashboardMetrics,
  TelemetryEvent,
  WorkflowGraphDetail,
  WorkflowRunSummary,
} from './types';

export interface FilterParams {
  mode: 'all' | 'live' | 'simulated';
  range: '1h' | '24h' | '7d' | '30d' | 'all';
  source: string;
}

function buildQuery(params: FilterParams, extra?: Record<string, string | number>): string {
  const sp = new URLSearchParams();
  sp.set('mode', params.mode);
  sp.set('range', params.range);
  if (params.source && params.source !== 'all') sp.set('source', params.source);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) sp.set(k, String(v));
  }
  return sp.toString();
}

export async function fetchMetrics(params: FilterParams): Promise<DashboardMetrics> {
  const res = await fetch(`/api/metrics?${buildQuery(params)}`);
  if (!res.ok) throw new Error(`Metrics failed: ${res.status}`);
  return res.json();
}

export async function fetchWorkflows(params: FilterParams): Promise<WorkflowRunSummary[]> {
  const res = await fetch(`/api/workflows?${buildQuery(params)}`);
  if (!res.ok) throw new Error(`Workflows failed: ${res.status}`);
  const data = (await res.json()) as { workflows: WorkflowRunSummary[] };
  return data.workflows;
}

export async function fetchWorkflowGraph(workflowId: string): Promise<WorkflowGraphDetail> {
  const res = await fetch(`/api/workflows/${encodeURIComponent(workflowId)}/graph`);
  if (!res.ok) throw new Error(`Graph failed: ${res.status}`);
  return res.json();
}

export async function fetchEvents(params: FilterParams, limit = 250): Promise<{ events: TelemetryEvent[]; total: number }> {
  const res = await fetch(`/api/events?${buildQuery(params, { limit })}`);
  if (!res.ok) throw new Error(`Events failed: ${res.status}`);
  return res.json();
}

export async function fetchExportSnapshot(params: FilterParams): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/export?${buildQuery(params)}`);
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.json();
}

export async function triggerScan(): Promise<{ added: number; scannedFiles: number }> {
  const res = await fetch('/api/scan', { method: 'POST' });
  if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
  return res.json();
}

export async function triggerSimulation(): Promise<{ workflowId: string; eventCount: number }> {
  const res = await fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instant: false }),
  });
  if (!res.ok) throw new Error(`Simulation failed: ${res.status}`);
  return res.json();
}

export async function clearSimulation(): Promise<{ removed: number }> {
  const res = await fetch('/api/simulate', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Clear simulation failed: ${res.status}`);
  return res.json();
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}
