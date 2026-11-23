#!/usr/bin/env node
import { exec } from 'node:child_process';
import { loadAgentPulseConfig } from './config/loadConfig.js';
import { LocalCollector } from './ingest/collector.js';
import { matchModelRate } from './pricing/catalog.js';
import { startServer } from './server.js';
import { streamSimulatedWorkflow } from './simulator/multiAgentSim.js';
import { TelemetryStore } from './store/telemetryStore.js';

function parseArgs(argv: string[], defaultPort: number, defaultPollMs: number) {
  const args = argv.slice(2);
  let port = Number(process.env.AGENTPULSE_PORT ?? defaultPort) || defaultPort;
  let host = process.env.AGENTPULSE_HOST ?? '127.0.0.1';
  let noOpen = false;
  let demo = false;
  let pollMs = defaultPollMs;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '--port' || a === '-p') && args[i + 1]) {
      port = Number(args[++i]) || port;
    } else if (a === '--host' && args[i + 1]) {
      host = args[++i];
    } else if (a === '--no-open') {
      noOpen = true;
    } else if (a === '--demo') {
      demo = true;
    } else if (a === '--poll' && args[i + 1]) {
      pollMs = Math.max(2000, Number(args[++i]) || pollMs);
    } else if (a === '--help' || a === '-h') {
      console.log(`
AgentPulse — Local Multi-Model Token & Multi-Agent Telemetry Observatory

Usage:
  agentpulse start [options]

Options:
  -p, --port <port>   Port for local dashboard & OTLP/HTTP collector (default: 4318)
  --host <host>       Bind address (default: 127.0.0.1)
  --demo              Seed a simulated multi-agent workflow on startup
  --no-open           Do not auto-open the browser
  --poll <ms>         Local log polling interval in ms (default: 10000)
  -h, --help          Show this help message

Configuration:
  Place custom paths in ./agentpulse.config.json or ~/.agentpulse/config.json
  (see agentpulse.config.example.json).
`);
      process.exit(0);
    }
  }

  return { port, host, noOpen, demo, pollMs };
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    // Best-effort browser open
  });
}

function logIdentifiedModels(store: TelemetryStore): void {
  const allEvents = store.query({ mode: 'all' });
  if (allEvents.length === 0) {
    console.log('  ➜  Models Found:   none yet (use Copilot/Claude/Codex or click Simulate Swarm)');
    return;
  }

  const byModel = new Map<string, { calls: number; tokens: number; provider: string; matched: boolean }>();
  for (const ev of allEvents) {
    const prev = byModel.get(ev.model) ?? {
      calls: 0,
      tokens: 0,
      provider: ev.provider,
      matched: matchModelRate(ev.model) !== null,
    };
    prev.calls += 1;
    prev.tokens += ev.totalTokens;
    byModel.set(ev.model, prev);
  }

  const sorted = Array.from(byModel.entries()).sort((a, b) => b[1].calls - a[1].calls);
  console.log(`  ➜  Models Identified (${sorted.length}):`);
  for (const [model, info] of sorted) {
    const tokLabel =
      info.tokens >= 1_000_000
        ? `${(info.tokens / 1_000_000).toFixed(2)}M tok`
        : info.tokens >= 1_000
          ? `${(info.tokens / 1_000).toFixed(1)}K tok`
          : `${info.tokens} tok`;
    const catalogTag = info.matched ? 'pricing:catalog' : 'pricing:unmapped';
    console.log(
      `       • ${model.padEnd(28)} ${String(info.calls).padStart(5)} calls  ${tokLabel.padStart(11)}  [${info.provider} · ${catalogTag}]`,
    );
  }
}

async function main() {
  const { config, loadedFrom } = loadAgentPulseConfig();
  const opts = parseArgs(process.argv, config.port ?? 4318, config.pollIntervalMs ?? 10_000);

  const store = new TelemetryStore();
  const collector = new LocalCollector(store);

  const scanRes = await collector.scanOnce(true);
  if (opts.demo) {
    streamSimulatedWorkflow(store, { instant: true, scenarioIndex: 0 });
    streamSimulatedWorkflow(store, { instant: true, scenarioIndex: 1 });
  }
  collector.startPolling(opts.pollMs);

  // Log newly arriving models during live polling/ingest
  store.subscribe((added) => {
    if (added.length === 0) return;
    const models = Array.from(new Set(added.map((e) => e.model))).join(', ');
    const sources = Array.from(new Set(added.map((e) => e.source))).join(', ');
    console.log(`[agentpulse] +${added.length} span(s) ingested | source: ${sources} | models: ${models}`);
  });

  const { server, url } = await startServer({ store, collector }, opts.port, opts.host);

  console.log('');
  console.log('  ⚡ AgentPulse Observatory is running locally');
  console.log(`  ➜  Dashboard:      ${url}`);
  console.log(`  ➜  OTLP Receiver:  ${url}/v1/traces`);
  console.log(`  ➜  SDK Ingest:     ${url}/api/ingest`);
  console.log(
    `  ➜  Config File:    ${loadedFrom.length > 0 ? loadedFrom.join(', ') : 'default auto-discovery (~/.agentpulse/config.json not set)'}`,
  );
  console.log(`  ➜  Local Events:   ${store.count()} loaded (${scanRes.scannedFiles} files scanned)`);

  const activeSources = collector
    .getSourceStatuses()
    .filter((s) => s.eventsIngested > 0)
    .map((s) => `${s.source}(${s.eventsIngested})`)
    .join(', ');
  console.log(`  ➜  Active Sources: ${activeSources || 'none detected yet'}`);
  logIdentifiedModels(store);
  console.log('');

  if (!opts.noOpen) {
    openBrowser(url);
  }

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    collector.stopPolling();
    store.flushNow();
    // Close active SSE / keep-alive sockets immediately so Ctrl+C / stop never hangs
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(() => process.exit(0));
    const forceTimer = setTimeout(() => process.exit(0), 800);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start AgentPulse:', err);
  process.exit(1);
});
