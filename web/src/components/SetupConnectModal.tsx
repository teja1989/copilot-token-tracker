import { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

interface Props {
  onClose: () => void;
}

const SNIPPETS = {
  otlp: `# Point any OpenTelemetry-instrumented app (LangGraph, CrewAI, AutoGen, OpenLLMetry)
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="http://127.0.0.1:4318/v1/traces"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/json"`,
  curl: `curl -X POST http://127.0.0.1:4318/api/ingest \\
  -H "Content-Type: application/json" \\
  -d '{
    "workflowId": "pr-review-42",
    "workflowName": "PR #42 Multi-Agent Review",
    "agentName": "Security Reviewer",
    "agentRole": "Reviewer",
    "parentAgentId": "pr-review-42:Coordinator",
    "model": "claude-sonnet-4-6",
    "inputTokens": 4800,
    "cachedReadTokens": 12000,
    "outputTokens": 920,
    "durationMs": 2350
  }'`,
  python: `import requests

requests.post("http://127.0.0.1:4318/api/ingest", json={
    "workflowId": "research-task-1",
    "workflowName": "Architecture Research",
    "agentName": "Code Researcher",
    "agentRole": "Researcher",
    "parentAgentId": "research-task-1:Lead",
    "model": "gpt-5.4",
    "inputTokens": 3200,
    "outputTokens": 1100,
    "durationMs": 1850,
})`,
};

export function SetupConnectModal({ onClose }: Props) {
  const [tab, setTab] = useState<'otlp' | 'curl' | 'python'>('otlp');
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    await navigator.clipboard.writeText(SNIPPETS[tab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
      <div className="m-card w-full max-w-2xl rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Connect Custom Agents & Models</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Copilot, Claude Code, Antigravity, and Codex are auto-discovered locally. Stream any other runtime via OTLP or HTTP:
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex gap-1.5 border-b border-[var(--border-subtle)] pb-2 text-xs">
          {(['otlp', 'curl', 'python'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${
                tab === k
                  ? 'bg-blue-600 text-white'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {k === 'otlp' ? 'OpenTelemetry (OTLP)' : k === 'curl' ? 'HTTP / cURL' : 'Python'}
            </button>
          ))}
        </div>

        <div className="relative mt-3">
          <pre className="m-subtle overflow-x-auto rounded-xl p-4 font-mono text-xs leading-relaxed text-[var(--text-primary)]">
            {SNIPPETS[tab]}
          </pre>
          <button
            onClick={copyCode}
            className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-primary)] shadow-xs hover:bg-[var(--bg-muted)]"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="m-subtle mt-3 rounded-xl px-3.5 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
          Local-only: listens on 127.0.0.1:4318 · persists normalized metadata to ~/.agentpulse/telemetry.jsonl
        </div>
      </div>
    </div>
  );
}
