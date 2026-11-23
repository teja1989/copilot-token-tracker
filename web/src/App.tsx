import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  GitBranch,
  GitCompareArrows,
  LayoutDashboard,
  Moon,
  Play,
  Plug,
  RefreshCw,
  Settings,
  Sun,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  clearSimulation,
  fetchEvents,
  fetchMetrics,
  fetchWorkflowGraph,
  fetchWorkflows,
  formatDuration,
  formatTokens,
  triggerScan,
  triggerSimulation,
  type FilterParams,
} from './api';
import { AgentSwarmGraph } from './components/AgentSwarmGraph';
import { AgentTimelineGantt } from './components/AgentTimelineGantt';
import { ContextGrowthChart } from './components/ContextGrowthChart';
import { EfficiencyInsights } from './components/EfficiencyInsights';
import { ExportModal } from './components/ExportModal';
import { KpiStrip } from './components/KpiStrip';
import { LiveEventFeed } from './components/LiveEventFeed';
import { ModelBreakdown } from './components/ModelBreakdown';
import { ProjectBreakdown } from './components/ProjectBreakdown';
import { SettingsModal } from './components/SettingsModal';
import { SetupConnectModal } from './components/SetupConnectModal';
import { TelemetryWidgets } from './components/TelemetryWidgets';
import { TokenTimelineChart } from './components/TokenTimelineChart';
import { WorkflowCompareModal } from './components/WorkflowCompareModal';
import type {
  DashboardMetrics,
  TelemetryEvent,
  WorkflowGraphDetail,
  WorkflowRunSummary,
} from './types';

type Tab = 'overview' | 'swarm' | 'stream';

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('agentpulse-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('agentpulse-theme', theme);
  }, [theme]);

  const [tab, setTab] = useState<Tab>('overview');
  const [filters, setFilters] = useState<FilterParams>({
    mode: 'all',
    range: 'all',
    source: 'all',
  });

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowRunSummary[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [graph, setGraph] = useState<WorkflowGraphDetail | null>(null);
  const [eventsData, setEventsData] = useState<{ events: TelemetryEvent[]; total: number }>({
    events: [],
    total: 0,
  });

  const [sseConnected, setSseConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [m, wfs, evs] = await Promise.all([
        fetchMetrics(filters),
        fetchWorkflows(filters),
        fetchEvents(filters, 250),
      ]);
      setMetrics(m);
      setWorkflows(wfs);
      setEventsData(evs);

      setSelectedWorkflowId((prev) => {
        if (prev && wfs.some((w) => w.workflowId === prev)) return prev;
        const multi = wfs.find((w) => w.agentCount > 1);
        return (multi ?? wfs[0])?.workflowId ?? null;
      });
    } catch (err) {
      console.error('Failed to refresh dashboard:', err);
    }
  }, [filters]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    fetchWorkflowGraph(selectedWorkflowId)
      .then((g) => {
        if (!cancelled) setGraph(g);
      })
      .catch(() => {
        if (!cancelled) setGraph(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWorkflowId, metrics?.generatedAtMs]);

  const loadAllRef = useRef(loadAll);
  useEffect(() => {
    loadAllRef.current = loadAll;
  }, [loadAll]);

  useEffect(() => {
    let es: EventSource | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (es || document.visibilityState === 'hidden') return;
      es = new EventSource('/api/stream');
      es.addEventListener('connected', () => setSseConnected(true));
      es.addEventListener('update', () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void loadAllRef.current();
        }, 500);
      });
      es.onerror = () => setSseConnected(false);
    };

    const disconnect = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (es) {
        es.close();
        es = null;
      }
      setSseConnected(false);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        disconnect();
      } else {
        void loadAllRef.current();
        connect();
      }
    };

    connect();
    window.addEventListener('beforeunload', disconnect);
    window.addEventListener('pagehide', disconnect);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('beforeunload', disconnect);
      window.removeEventListener('pagehide', disconnect);
      document.removeEventListener('visibilitychange', onVisibility);
      disconnect();
    };
  }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await triggerScan();
      await loadAll();
      showToast(`Scanned ${res.scannedFiles} files (+${res.added} spans)`);
    } finally {
      setScanning(false);
    }
  };

  const handleSimulate = async () => {
    setSimulating(true);
    try {
      const res = await triggerSimulation();
      setSelectedWorkflowId(res.workflowId);
      setTab('swarm');
      showToast(`Streaming ${res.eventCount} multi-agent spans...`);
    } finally {
      setTimeout(() => setSimulating(false), 1000);
    }
  };

  const handleClearSim = async () => {
    const res = await clearSimulation();
    await loadAll();
    showToast(`Cleared ${res.removed} simulated spans`);
  };

  const hasSimulated = workflows.some((w) => w.isSimulated);

  return (
    <div className="min-h-screen pb-14">
      {/* Material App Bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 font-mono text-xs font-bold text-white shadow-sm">
                AP
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tracking-tight text-[var(--text-primary)]">AgentPulse</span>
                  <span className="m-pill flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium">
                    <span className={`h-1.5 w-1.5 rounded-full ${sseConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {sseConnected ? 'LIVE' : 'OFFLINE'}
                  </span>
                </div>
              </div>
            </div>

            {/* Navigation Pills */}
            <nav className="hidden items-center gap-1 md:flex">
              {[
                { id: 'overview', label: 'Overview', icon: LayoutDashboard },
                { id: 'swarm', label: `Agent Topology (${workflows.length})`, icon: GitBranch },
                { id: 'stream', label: `Spans (${eventsData.total})`, icon: Terminal },
              ].map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setTab(item.id as Tab)}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5 text-[11px]">
              {(['all', 'live', 'simulated'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFilters((f) => ({ ...f, mode: m }))}
                  className={`rounded-lg px-2.5 py-1 capitalize transition ${
                    filters.mode === m
                      ? 'bg-[var(--bg-surface)] font-semibold text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {m === 'live' ? 'Local' : m}
                </button>
              ))}
            </div>

            <div className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5 font-mono text-[11px]">
              {(['1h', '24h', '7d', '30d', 'all'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setFilters((f) => ({ ...f, range: r }))}
                  className={`rounded-lg px-2 py-1 uppercase transition ${
                    filters.range === r
                      ? 'bg-[var(--bg-surface)] font-semibold text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
              Rescan
            </button>

            <button
              onClick={handleSimulate}
              disabled={simulating}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Simulate Swarm
            </button>

            {hasSimulated && (
              <button
                onClick={handleClearSim}
                className="flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-500/20 dark:text-rose-400"
                title="Clear simulated workflows"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              onClick={() => setShowCompare(true)}
              disabled={workflows.length < 2}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
              title="Compare two workflows side-by-side"
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              Compare
            </button>

            <button
              onClick={() => setShowExport(true)}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
              title="Review and download telemetry JSON"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>

            <button
              onClick={() => setShowConnect(true)}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
            >
              <Plug className="h-3.5 w-3.5" />
              SDK / OTLP
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
              title="Settings & Custom Local Paths"
              aria-label="Open Settings"
            >
              <Settings className="h-4 w-4" />
            </button>

            {/* Light / Dark Mode Switch */}
            <button
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
              title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
              aria-label="Toggle color theme"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4 text-amber-400" />}
            </button>
          </div>
        </div>

        {/* Mobile Tabs */}
        <div className="flex border-t border-[var(--border-subtle)] px-4 md:hidden">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'swarm', label: `Topology (${workflows.length})` },
            { id: 'stream', label: `Spans (${eventsData.total})` },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id as Tab)}
              className={`border-b-2 px-3 py-2 text-xs font-medium ${
                tab === item.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-[var(--text-muted)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {toast && (
        <div className="m-card fixed right-5 bottom-5 z-50 rounded-xl px-4 py-2.5 font-mono text-xs font-medium text-[var(--text-primary)] shadow-xl">
          {toast}
        </div>
      )}

      <main className="mx-auto mt-6 max-w-[1440px] space-y-5 px-4 sm:px-6">
        {metrics && <KpiStrip kpis={metrics.kpis} />}

        {tab === 'overview' && metrics && (
          <>
            {/* Interactive Performance Rings + Token Composition + Activity Heatmap */}
            <TelemetryWidgets kpis={metrics.kpis} timeSeries={metrics.timeSeries} />

            {/* Local Sources Strip */}
            <div className="m-card rounded-2xl p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Local Agent Collectors & Receivers
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">Click any source to filter</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                {metrics.sources.map((src) => {
                  const selected = filters.source === src.source;
                  return (
                    <button
                      key={src.source}
                      onClick={() =>
                        setFilters((f) => ({
                          ...f,
                          source: f.source === src.source ? 'all' : src.source,
                        }))
                      }
                      className={`rounded-xl border px-3 py-2.5 text-left transition ${
                        selected
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{src.label}</span>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            src.eventsIngested > 0
                              ? 'bg-emerald-500'
                              : src.detected
                                ? 'bg-blue-500'
                                : 'bg-slate-400/50'
                          }`}
                        />
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                        {src.eventsIngested > 0
                          ? `${src.eventsIngested} spans`
                          : src.detected
                            ? 'Listening'
                            : 'Not detected'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <TokenTimelineChart data={metrics.timeSeries} />
            <ModelBreakdown models={metrics.byModel} />
            <ProjectBreakdown projects={metrics.byProject} />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="m-card rounded-2xl p-5 lg:col-span-5">
                <h3 className="mb-3.5 text-sm font-semibold text-[var(--text-primary)]">Top Tool Invocations</h3>
                {metrics.topTools.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No tool calls recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {metrics.topTools.slice(0, 8).map((t) => {
                      const maxCalls = metrics.topTools[0]?.calls || 1;
                      const pct = Math.round((t.calls / maxCalls) * 100);
                      return (
                        <div key={t.toolName}>
                          <div className="flex items-center justify-between font-mono text-xs">
                            <span className="truncate font-medium text-[var(--text-primary)]">{t.toolName}</span>
                            <span className="text-[var(--text-muted)]">
                              {t.calls}× · {formatDuration(t.avgDurationMs)}
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--bg-muted)]">
                            <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="lg:col-span-7">
                <EfficiencyInsights insights={metrics.insights} />
              </div>
            </div>
          </>
        )}

        {tab === 'swarm' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Workflow Run List */}
            <div className="m-card rounded-2xl p-4 lg:col-span-3">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Workflow Runs</h3>
                <span className="m-pill rounded-full px-2 py-0.5 font-mono text-[11px]">{workflows.length}</span>
              </div>

              {workflows.length === 0 ? (
                <div className="m-subtle rounded-xl p-4 text-center text-xs text-[var(--text-muted)]">
                  No workflows captured yet.
                </div>
              ) : (
                <div className="max-h-[760px] space-y-2 overflow-y-auto pr-1">
                  {workflows.map((wf) => {
                    const active = wf.workflowId === selectedWorkflowId;
                    return (
                      <button
                        key={wf.workflowId}
                        onClick={() => setSelectedWorkflowId(wf.workflowId)}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          active
                            ? 'border-blue-500 bg-blue-500/8'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-2 text-xs font-semibold text-[var(--text-primary)]">
                            {wf.workflowName}
                          </span>
                          <span className="m-pill shrink-0 rounded-full px-2 py-0.5 font-mono text-[9.5px] font-medium">
                            {wf.isSimulated ? 'sim' : wf.source}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] text-[var(--text-muted)]">
                          <span className={wf.agentCount > 1 ? 'font-semibold text-blue-600 dark:text-blue-400' : ''}>
                            {wf.agentCount} {wf.agentCount === 1 ? 'agent' : 'agents'}
                          </span>
                          <span>{formatTokens(wf.totalTokens)} tok</span>
                          <span>{formatDuration(wf.durationMs)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Topology Graph + Trace Waterfall */}
            <div className="space-y-5 lg:col-span-9">
              {graph ? (
                <>
                  <AgentSwarmGraph graph={graph} />
                  <ContextGrowthChart graph={graph} />
                  <AgentTimelineGantt graph={graph} />
                </>
              ) : (
                <div className="m-card flex h-72 items-center justify-center rounded-2xl text-xs text-[var(--text-muted)]">
                  Select a workflow to inspect multi-agent attribution.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'stream' && <LiveEventFeed events={eventsData.events} total={eventsData.total} />}
      </main>

      {showConnect && <SetupConnectModal onClose={() => setShowConnect(false)} />}
      {showExport && <ExportModal filters={filters} onClose={() => setShowExport(false)} />}
      {showCompare && <WorkflowCompareModal workflows={workflows} onClose={() => setShowCompare(false)} />}
      {showSettings && metrics && (
        <SettingsModal
          sources={metrics.sources}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            void loadAll();
            showToast('Saved custom paths & rescanned local sources');
          }}
        />
      )}
    </div>
  );
}
