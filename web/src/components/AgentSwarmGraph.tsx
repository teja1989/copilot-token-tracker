import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Cpu,
  GitBranch,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Wrench,
  X,
} from 'lucide-react';
import { formatDuration, formatTokens } from '../api';
import type { AgentNodeSummary, WorkflowGraphDetail } from '../types';

interface Props {
  graph: WorkflowGraphDetail;
}

interface ProgressiveAgentStats {
  calls: number;
  errors: number;
  totalTokens: number;
  inputTokens: number;
  cachedReadTokens: number;
  outputTokens: number;
  durationSumMs: number;
}

const ROLE_ACCENT: Record<string, string> = {
  Coordinator: '#2563eb',
  Planner: '#7c3aed',
  Researcher: '#0284c7',
  Coder: '#059669',
  Reviewer: '#d97706',
  Tester: '#db2777',
  Subagent: '#64748b',
};

const NODE_W = 232;
const NODE_H = 108;
const COL_GAP = 96;
const ROW_GAP = 28;
const PAD_X = 36;
const PAD_Y = 36;

export function AgentSwarmGraph({ graph }: Props) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [zoom, setZoom] = useState(1);

  // DVR Session Replay state
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2>(1);

  const orderedSpans = useMemo(
    () => [...graph.spans].sort((a, b) => a.startTimeMs - b.startTimeMs),
    [graph.spans],
  );

  const totalSteps = orderedSpans.length;
  const clampedReplayIndex = totalSteps > 0 ? Math.min(replayIndex, totalSteps - 1) : 0;

  useEffect(() => {
    setIsReplayMode(false);
    setIsPlaying(false);
    setReplayIndex(0);
  }, [graph.workflow.workflowId]);

  useEffect(() => {
    if (!isReplayMode || !isPlaying || totalSteps === 0) return;
    const intervalMs = playbackSpeed === 2 ? 550 : 1100;
    const timer = window.setInterval(() => {
      setReplayIndex((prev) => {
        if (prev >= totalSteps - 1) {
          setIsPlaying(false);
          return totalSteps - 1;
        }
        return prev + 1;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isReplayMode, isPlaying, playbackSpeed, totalSteps]);

  const currentReplaySpan = isReplayMode && totalSteps > 0 ? orderedSpans[clampedReplayIndex] ?? null : null;

  const replayState = useMemo(() => {
    if (!isReplayMode || totalSteps === 0) {
      return {
        statsByAgent: null as Map<string, ProgressiveAgentStats> | null,
        traversedEdges: null as Set<string> | null,
        activeEdgeKey: null as string | null,
      };
    }

    const statsByAgent = new Map<string, ProgressiveAgentStats>();
    const traversedEdges = new Set<string>();
    const slice = orderedSpans.slice(0, clampedReplayIndex + 1);

    for (const sp of slice) {
      const existing = statsByAgent.get(sp.agentId) ?? {
        calls: 0,
        errors: 0,
        totalTokens: 0,
        inputTokens: 0,
        cachedReadTokens: 0,
        outputTokens: 0,
        durationSumMs: 0,
      };
      existing.calls += 1;
      if (sp.status === 'error') existing.errors += 1;
      existing.totalTokens += sp.totalTokens;
      existing.inputTokens += sp.inputTokens;
      existing.cachedReadTokens += sp.cachedReadTokens;
      existing.outputTokens += sp.outputTokens;
      existing.durationSumMs += sp.durationMs;
      statsByAgent.set(sp.agentId, existing);

      if (sp.parentAgentId && sp.parentAgentId !== sp.agentId) {
        traversedEdges.add(`${sp.parentAgentId}-->${sp.agentId}`);
      }
    }

    const activeEdgeKey =
      currentReplaySpan?.parentAgentId && currentReplaySpan.parentAgentId !== currentReplaySpan.agentId
        ? `${currentReplaySpan.parentAgentId}-->${currentReplaySpan.agentId}`
        : null;

    return { statsByAgent, traversedEdges, activeEdgeKey };
  }, [isReplayMode, totalSteps, orderedSpans, clampedReplayIndex, currentReplaySpan]);

  const handleEnterReplay = () => {
    if (totalSteps === 0) return;
    setIsReplayMode(true);
    setReplayIndex(0);
    setIsPlaying(false);
  };

  const handleExitReplay = () => {
    setIsReplayMode(false);
    setIsPlaying(false);
    setReplayIndex(0);
  };

  const handleTogglePlay = () => {
    if (totalSteps === 0) return;
    if (!isReplayMode) {
      setIsReplayMode(true);
      setReplayIndex(0);
      setIsPlaying(true);
      return;
    }
    if (!isPlaying && clampedReplayIndex >= totalSteps - 1) {
      setReplayIndex(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((p) => !p);
  };

  const handlePrevStep = () => {
    if (totalSteps === 0) return;
    setIsPlaying(false);
    if (!isReplayMode) {
      setIsReplayMode(true);
      setReplayIndex(Math.max(0, totalSteps - 2));
      return;
    }
    setReplayIndex((i) => Math.max(0, i - 1));
  };

  const handleNextStep = () => {
    if (totalSteps === 0) return;
    setIsPlaying(false);
    if (!isReplayMode) {
      setIsReplayMode(true);
      setReplayIndex(0);
      return;
    }
    setReplayIndex((i) => Math.min(totalSteps - 1, i + 1));
  };

  const handleSliderChange = (stepOneBased: number) => {
    if (totalSteps === 0) return;
    setIsReplayMode(true);
    setIsPlaying(false);
    setReplayIndex(Math.max(0, Math.min(totalSteps - 1, stepOneBased - 1)));
  };

  const criticalSet = useMemo(() => new Set(graph.criticalPathAgentIds), [graph.criticalPathAgentIds]);
  const criticalEdges = useMemo(() => {
    const set = new Set<string>();
    const path = graph.criticalPathAgentIds;
    for (let i = 0; i < path.length - 1; i++) {
      set.add(`${path[i]}-->${path[i + 1]}`);
    }
    return set;
  }, [graph.criticalPathAgentIds]);

  const maxNodeTokens = useMemo(
    () => Math.max(1, ...graph.nodes.map((n) => n.totalTokens)),
    [graph.nodes],
  );

  const layout = useMemo(() => {
    const byDepth = new Map<number, AgentNodeSummary[]>();
    let maxDepth = 0;
    for (const node of graph.nodes) {
      maxDepth = Math.max(maxDepth, node.depth);
      const list = byDepth.get(node.depth) ?? [];
      list.push(node);
      byDepth.set(node.depth, list);
    }

    let maxRows = 1;
    for (const list of byDepth.values()) maxRows = Math.max(maxRows, list.length);

    const width = Math.max(720, PAD_X * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP);
    const height = Math.max(330, PAD_Y * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP);

    const positions = new Map<string, { x: number; y: number }>();
    for (const [depth, list] of byDepth.entries()) {
      const colHeight = list.length * NODE_H + Math.max(0, list.length - 1) * ROW_GAP;
      const startY = (height - colHeight) / 2;
      list.forEach((node, idx) => {
        positions.set(node.agentId, {
          x: PAD_X + depth * (NODE_W + COL_GAP),
          y: startY + idx * (NODE_H + ROW_GAP),
        });
      });
    }

    return { width, height, positions };
  }, [graph.nodes]);

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.agentId === selectedAgentId) ?? null,
    [graph.nodes, selectedAgentId],
  );

  const selectedSpans = useMemo(
    () => (selectedAgentId ? graph.spans.filter((s) => s.agentId === selectedAgentId) : []),
    [graph.spans, selectedAgentId],
  );

  const agentNameById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.agentId, n.agentName])),
    [graph.nodes],
  );

  const { collaboration } = graph;

  return (
    <div className="m-card overflow-hidden rounded-2xl">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400">
            <GitBranch className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">{graph.workflow.workflowName}</div>
            <div className="font-mono text-[11px] text-[var(--text-muted)]">
              {graph.nodes.length} agents · {graph.edges.length} handoff links · {formatTokens(graph.workflow.totalTokens)} tokens
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCriticalPath((v) => !v)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
              showCriticalPath
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Critical Path
          </button>
          <div className="flex items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]">
            <button
              onClick={() => setZoom((z) => Math.max(0.65, Math.round((z - 0.15) * 100) / 100))}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Zoom out"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 font-mono text-[11px] text-[var(--text-secondary)]">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(1.35, Math.round((z + 0.15) * 100) / 100))}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Zoom in"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Multi-Agent Collaboration Telemetry Bar */}
      <div className="grid grid-cols-2 divide-y divide-[var(--border-subtle)] border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] sm:grid-cols-5 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-2.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Parallelism</div>
          <div className="font-mono text-sm font-bold text-[var(--text-primary)]">
            {collaboration.parallelismFactor.toFixed(2)}×
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Delegation Depth</div>
          <div className="font-mono text-sm font-bold text-[var(--text-primary)]">
            {collaboration.maxDelegationDepth} {collaboration.maxDelegationDepth === 1 ? 'hop' : 'hops'}
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Total Handoffs</div>
          <div className="font-mono text-sm font-bold text-[var(--text-primary)]">{collaboration.totalHandoffs}</div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Coordinator Share</div>
          <div className="font-mono text-sm font-bold text-[var(--text-primary)]">
            {Math.round(collaboration.coordinatorTokenShare * 100)}%
          </div>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[11px] font-medium text-[var(--text-muted)]">Tool Success</div>
          <div className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
            {Math.round(collaboration.toolSuccessRate * 100)}%
          </div>
        </div>
      </div>

      {/* DVR Session Replay Scrubber */}
      {totalSteps > 0 && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Mode Toggle + Transport Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5 text-[11px]">
                <button
                  onClick={handleExitReplay}
                  className={`rounded-lg px-2.5 py-1 font-medium transition ${
                    !isReplayMode
                      ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Full View
                </button>
                <button
                  onClick={handleEnterReplay}
                  className={`rounded-lg px-2.5 py-1 font-medium transition ${
                    isReplayMode
                      ? 'bg-[var(--bg-surface)] text-blue-600 shadow-xs dark:text-blue-400'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Replay Mode
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-0.5">
                <button
                  onClick={handlePrevStep}
                  disabled={isReplayMode && clampedReplayIndex <= 0}
                  className="rounded-lg p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Previous step"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleTogglePlay}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    isPlaying
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-muted)]'
                  }`}
                  title={isPlaying ? 'Pause replay' : 'Play replay'}
                >
                  {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </button>
                <button
                  onClick={handleNextStep}
                  disabled={isReplayMode && clampedReplayIndex >= totalSteps - 1}
                  className="rounded-lg p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Next step"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleExitReplay}
                  disabled={!isReplayMode}
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="Reset to Live / Full View"
                >
                  <span className="inline-flex items-center gap-1">
                    <RotateCcw className="h-3 w-3" />
                    Live
                  </span>
                </button>
              </div>

              <button
                onClick={() => setPlaybackSpeed((s) => (s === 1 ? 2 : 1))}
                className="m-pill rounded-lg border border-[var(--border-subtle)] px-2 py-1 font-mono text-[11px] font-semibold transition hover:text-[var(--text-primary)]"
                title="Toggle playback speed"
              >
                {playbackSpeed}×
              </button>
            </div>

            {/* Scrubber Slider */}
            <div className="flex min-w-[200px] flex-1 items-center gap-2.5">
              <input
                type="range"
                aria-label="Replay step scrubber"
                min={1}
                max={totalSteps}
                value={isReplayMode ? clampedReplayIndex + 1 : totalSteps}
                onChange={(e) => handleSliderChange(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer accent-blue-600"
              />
              <span className="shrink-0 font-mono text-[11px] font-medium text-[var(--text-secondary)]">
                {isReplayMode ? `Step ${clampedReplayIndex + 1} / ${totalSteps}` : `${totalSteps} spans`}
              </span>
            </div>
          </div>

          {/* Live 1-line Replay Ticker */}
          {isReplayMode && currentReplaySpan && (
            <div className="m-subtle mt-2 flex items-center justify-between gap-3 rounded-xl px-3 py-1.5 font-mono text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: ROLE_ACCENT[currentReplaySpan.agentRole] ?? '#64748b' }}
                />
                <span className="shrink-0 font-semibold text-[var(--text-primary)]">
                  {currentReplaySpan.agentName}
                </span>
                <span className="text-[var(--text-muted)]">·</span>
                <span className="truncate text-[var(--text-secondary)]">
                  {currentReplaySpan.toolName
                    ? `${currentReplaySpan.operation} (${currentReplaySpan.toolName})`
                    : currentReplaySpan.operation}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2.5 text-[10.5px]">
                <span className="hidden text-[var(--text-muted)] sm:inline">{currentReplaySpan.model}</span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {formatTokens(currentReplaySpan.totalTokens)} tok
                </span>
                <span className="text-[var(--text-muted)]">{formatDuration(currentReplaySpan.durationMs)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    currentReplaySpan.status === 'error'
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : currentReplaySpan.status === 'running'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {currentReplaySpan.status}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Canvas + Docked Right Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div
          className={`overflow-auto bg-[var(--bg-canvas)] ${selectedNode ? 'lg:col-span-8' : 'lg:col-span-12'}`}
          style={{ maxHeight: 460 }}
        >
          <svg
            width={layout.width * zoom}
            height={layout.height * zoom}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="block select-none"
          >
            <defs>
              <pattern id="dotPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="var(--border-strong)" fillOpacity="0.45" />
              </pattern>
              <marker id="arrowBlue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#64748b" />
              </marker>
              <marker id="arrowCrit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#e11d48" />
              </marker>
              <marker id="arrowReplayActive" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#2563eb" />
              </marker>
            </defs>

            <rect width={layout.width} height={layout.height} fill="url(#dotPattern)" />

            {/* Handoff Edges */}
            {graph.edges.map((edge) => {
              const from = layout.positions.get(edge.fromAgentId);
              const to = layout.positions.get(edge.toAgentId);
              if (!from || !to) return null;

              const isBackward = from.x >= to.x;
              const x1 = isBackward ? from.x + NODE_W / 2 : from.x + NODE_W;
              const y1 = isBackward ? from.y + NODE_H : from.y + NODE_H / 2;
              const x2 = isBackward ? to.x + NODE_W / 2 : to.x;
              const y2 = isBackward ? to.y + NODE_H : to.y + NODE_H / 2;

              const d = isBackward
                ? `M ${x1} ${y1} C ${x1} ${y1 + 56}, ${x2} ${y2 + 56}, ${x2} ${y2}`
                : `M ${x1} ${y1} C ${x1 + COL_GAP * 0.55} ${y1}, ${x2 - COL_GAP * 0.55} ${y2}, ${x2} ${y2}`;

              const edgeKey = `${edge.fromAgentId}-->${edge.toAgentId}`;
              const isReplayActiveEdge = isReplayMode && replayState.activeEdgeKey === edgeKey;
              const isEdgeTraversed = !isReplayMode || (replayState.traversedEdges?.has(edgeKey) ?? false);

              const isCrit = showCriticalPath && criticalEdges.has(edge.id);
              const strokeColor = isReplayActiveEdge ? '#2563eb' : isCrit ? '#e11d48' : '#94a3b8';
              const strokeWidth = isReplayActiveEdge ? 3 : isCrit ? 2.2 : 1.6;
              const markerEnd = isReplayActiveEdge
                ? 'url(#arrowReplayActive)'
                : isCrit
                  ? 'url(#arrowCrit)'
                  : 'url(#arrowBlue)';
              const midX = (x1 + x2) / 2;
              const midY = isBackward ? Math.max(y1, y2) + 40 : (y1 + y2) / 2 - 10;

              return (
                <g key={edge.id} opacity={isEdgeTraversed ? 1 : 0.22}>
                  <path
                    d={d}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={isBackward ? '5 4' : undefined}
                    markerEnd={markerEnd}
                  />
                  {(!isReplayMode || isReplayActiveEdge) && (
                    <circle r={isReplayActiveEdge ? 4 : isCrit ? 3 : 2.5} fill={isReplayActiveEdge ? '#2563eb' : isCrit ? '#e11d48' : '#2563eb'}>
                      <animateMotion
                        dur={isReplayActiveEdge ? '1.1s' : isCrit ? '2.4s' : '3.4s'}
                        repeatCount="indefinite"
                        path={d}
                      />
                    </circle>
                  )}
                  <g transform={`translate(${midX}, ${midY})`}>
                    <rect
                      x={-32}
                      y={-10}
                      width={64}
                      height={18}
                      rx={9}
                      fill="var(--bg-surface)"
                      stroke={isReplayActiveEdge ? '#2563eb' : 'var(--border-subtle)'}
                      strokeWidth={isReplayActiveEdge ? 1.5 : 1}
                    />
                    <text
                      textAnchor="middle"
                      y={3}
                      fill={isReplayActiveEdge ? '#2563eb' : 'var(--text-secondary)'}
                      fontSize={9.5}
                      fontFamily="ui-monospace, monospace"
                    >
                      {edge.tokensTransferred > 0 ? formatTokens(edge.tokensTransferred) : `${edge.handoffCount}×`}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Material Agent Cards */}
            {graph.nodes.map((node) => {
              const pos = layout.positions.get(node.agentId);
              if (!pos) return null;
              const accent = ROLE_ACCENT[node.agentRole] ?? '#64748b';
              const isCrit = showCriticalPath && criticalSet.has(node.agentId);
              const isSelected = selectedAgentId === node.agentId;

              const progStats = isReplayMode ? replayState.statsByAgent?.get(node.agentId) ?? null : null;
              const isNotYetStarted = isReplayMode && !progStats;
              const isReplayActive = isReplayMode && currentReplaySpan?.agentId === node.agentId;

              const displayTokens = isReplayMode ? (progStats?.totalTokens ?? 0) : node.totalTokens;
              const displayCalls = isReplayMode ? (progStats?.calls ?? 0) : node.calls;
              const displayErrors = isReplayMode ? (progStats?.errors ?? 0) : node.errors;
              const displayAvgLatency = isReplayMode
                ? progStats && progStats.calls > 0
                  ? progStats.durationSumMs / progStats.calls
                  : 0
                : node.avgLatencyMs;

              const tokenPct = isNotYetStarted
                ? 0
                : Math.max(5, Math.round((displayTokens / maxNodeTokens) * 100));

              return (
                <g
                  key={node.agentId}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => setSelectedAgentId(isSelected ? null : node.agentId)}
                  className="cursor-pointer"
                  opacity={isNotYetStarted ? 0.34 : 1}
                >
                  {isReplayActive && (
                    <rect
                      x={-5}
                      y={-5}
                      width={NODE_W + 10}
                      height={NODE_H + 10}
                      rx={18}
                      fill="none"
                      stroke={accent}
                      strokeWidth={2.5}
                      strokeOpacity={0.75}
                    >
                      <animate attributeName="stroke-opacity" values="0.9;0.2;0.9" dur="1.3s" repeatCount="indefinite" />
                      <animate attributeName="stroke-width" values="2;4.5;2" dur="1.3s" repeatCount="indefinite" />
                    </rect>
                  )}

                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={14}
                    fill="var(--bg-surface)"
                    stroke={
                      isReplayActive
                        ? accent
                        : isSelected
                          ? '#2563eb'
                          : isCrit
                            ? '#e11d48'
                            : 'var(--border-subtle)'
                    }
                    strokeWidth={isReplayActive ? 2.2 : isSelected ? 2 : isCrit ? 1.5 : 1}
                  />
                  <rect x={0} y={14} width={4} height={NODE_H - 28} rx={2} fill={accent} />

                  <foreignObject x={6} y={0} width={NODE_W - 6} height={NODE_H}>
                    <div className="flex h-full flex-col justify-between p-3 text-left">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0">
                          <div
                            className="truncate text-xs font-semibold text-[var(--text-primary)]"
                            title={node.agentName}
                          >
                            {node.agentName}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
                            {node.models[0] ?? 'unknown'}
                          </div>
                        </div>
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold text-white"
                          style={{ backgroundColor: accent }}
                        >
                          {node.agentRole}
                        </span>
                      </div>

                      <div>
                        <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-muted)]">
                          <div
                            className="h-full rounded-full transition-all duration-200"
                            style={{ width: `${tokenPct}%`, backgroundColor: accent }}
                          />
                        </div>
                        <div className="flex items-center justify-between font-mono text-[10.5px]">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {formatTokens(displayTokens)} tok
                          </span>
                          <span className="text-[var(--text-muted)]">{displayCalls} calls</span>
                          <span className={displayErrors > 0 ? 'font-semibold text-rose-500' : 'text-[var(--text-muted)]'}>
                            {isNotYetStarted
                              ? 'waiting'
                              : displayErrors > 0
                                ? `${displayErrors} err`
                                : formatDuration(displayAvgLatency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Docked Right-Hand Agent Inspector */}
        {selectedNode && (
          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4 lg:col-span-4 lg:border-t-0 lg:border-l">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{selectedNode.agentName}</span>
                  <span className="m-pill rounded-full px-2 py-0.5 text-[10px] font-medium">
                    {selectedNode.agentRole}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                  {selectedNode.models.join(', ')}
                </div>
              </div>
              <button
                onClick={() => setSelectedAgentId(null)}
                className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 font-mono text-[11px]">
              <div>
                <div className="text-[10px] text-[var(--text-muted)]">Input</div>
                <div className="font-semibold text-blue-600 dark:text-blue-400">
                  {formatTokens(selectedNode.inputTokens)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-muted)]">Cached</div>
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatTokens(selectedNode.cachedReadTokens)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-muted)]">Output</div>
                <div className="font-semibold text-indigo-600 dark:text-indigo-400">
                  {formatTokens(selectedNode.outputTokens)}
                </div>
              </div>
            </div>

            <div className="mt-3 text-[11px] font-semibold text-[var(--text-muted)]">
              Spans ({selectedSpans.length})
            </div>
            <div className="mt-1.5 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {selectedSpans.map((sp) => (
                <div
                  key={sp.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {sp.status === 'error' ? (
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                      ) : sp.toolName ? (
                        <Wrench className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      ) : (
                        <Cpu className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                      )}
                      <span className="truncate font-mono font-medium text-[var(--text-primary)]">
                        {sp.operation}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[var(--text-muted)]">
                      {formatDuration(sp.durationMs)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[var(--text-muted)]">
                    <span>{formatTokens(sp.totalTokens)} tok</span>
                    <span>{sp.model}</span>
                  </div>
                  {sp.errorMessage && (
                    <div className="mt-1 font-mono text-[10px] text-rose-500">{sp.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Handoff Matrix Table */}
      {graph.edges.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] px-5 py-3.5">
          <div className="mb-2 text-xs font-semibold text-[var(--text-primary)]">
            Agent-to-Agent Handoff Ledger
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[10px] uppercase text-[var(--text-muted)]">
                  <th className="pb-2 pr-3 font-medium">From Agent</th>
                  <th className="pb-2 pr-3 font-medium">To Agent</th>
                  <th className="pb-2 pr-3 font-medium">Handoffs</th>
                  <th className="pb-2 pr-3 font-medium">Tokens Transferred</th>
                  <th className="pb-2 text-right font-medium">Avg Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {graph.edges.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--bg-subtle)]">
                    <td className="py-2 pr-3 text-[var(--text-primary)]">
                      {agentNameById.get(e.fromAgentId) ?? e.fromAgentId}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-primary)]">
                      {agentNameById.get(e.toAgentId) ?? e.toAgentId}
                    </td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{e.handoffCount}×</td>
                    <td className="py-2 pr-3 font-semibold text-[var(--text-primary)]">
                      {formatTokens(e.tokensTransferred)}
                    </td>
                    <td className="py-2 text-right text-[var(--text-muted)]">{formatDuration(e.avgLatencyMs)}</td>
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
