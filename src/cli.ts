#!/usr/bin/env node
import { exec } from 'node:child_process';
import { LocalCollector } from './ingest/collector.js';
import { startServer } from './server.js';
import { streamSimulatedWorkflow } from './simulator/multiAgentSim.js';
import { TelemetryStore } from './store/telemetryStore.js';

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let port = Number(process.env.AGENTPULSE_PORT ?? 4318) || 4318;
  let host = process.env.AGENTPULSE_HOST ?? '127.0.0.1';
  let noOpen = false;
  let demo = false;
  let pollMs = 10_000;

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

async function main() {
  const opts = parseArgs(process.argv);
  const store = new TelemetryStore();
  const collector = new LocalCollector(store);

  const scanRes = await collector.scanOnce(true);
  if (opts.demo) {
    streamSimulatedWorkflow(store, { instant: true, scenarioIndex: 0 });
    streamSimulatedWorkflow(store, { instant: true, scenarioIndex: 1 });
  }
  collector.startPolling(opts.pollMs);

  const { server, url } = await startServer({ store, collector }, opts.port, opts.host);

  console.log('');
  console.log('  ⚡ AgentPulse Observatory is running locally');
  console.log(`  ➜  Dashboard:      ${url}`);
  console.log(`  ➜  OTLP Receiver:  ${url}/v1/traces`);
  console.log(`  ➜  SDK Ingest:     ${url}/api/ingest`);
  console.log(`  ➜  Local Events:   ${store.count()} loaded (${scanRes.scannedFiles} files scanned)`);
  console.log('');

  if (!opts.noOpen) {
    openBrowser(url);
  }

  const shutdown = () => {
    collector.stopPolling();
    store.flushNow();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start AgentPulse:', err);
  process.exit(1);
});
