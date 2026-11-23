import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { buildWorkflowGraph, buildWorkflowSummaries } from './analytics/agentGraph.js';
import { computeDashboardMetrics } from './analytics/metrics.js';
import {
  getGlobalConfigPath,
  loadAgentPulseConfig,
  replaceGlobalConfig,
  type AgentPulseConfig,
} from './config/loadConfig.js';
import type { LocalCollector } from './ingest/collector.js';
import { normalizeSimpleIngest, parseOtlpTraces, type SimpleIngestEvent } from './ingest/otlp.js';
import type { QueryFilter, SourceKind } from './model/types.js';
import { streamSimulatedWorkflow } from './simulator/multiAgentSim.js';
import type { TelemetryStore } from './store/telemetryStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseRangeToSinceMs(range?: string): number | undefined {
  const now = Date.now();
  switch (range) {
    case '1h':
      return now - 3600_000;
    case '24h':
      return now - 24 * 3600_000;
    case '7d':
      return now - 7 * 24 * 3600_000;
    case '30d':
      return now - 30 * 24 * 3600_000;
    default:
      return undefined;
  }
}

function extractFilter(req: Request): QueryFilter {
  const modeRaw = String(req.query.mode ?? 'all');
  const mode: QueryFilter['mode'] =
    modeRaw === 'live' || modeRaw === 'simulated' ? modeRaw : 'all';

  const sourceRaw = String(req.query.source ?? 'all');
  const source = sourceRaw as SourceKind | 'all';

  const model = typeof req.query.model === 'string' && req.query.model ? req.query.model : undefined;
  const range = typeof req.query.range === 'string' ? req.query.range : undefined;
  const sinceMs = parseRangeToSinceMs(range);

  return { mode, source, model, sinceMs };
}

export interface ServerDeps {
  store: TelemetryStore;
  collector: LocalCollector;
  webDistDir?: string;
}

export function createApp({ store, collector, webDistDir }: ServerDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  const startedAt = Date.now();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      uptimeMs: Date.now() - startedAt,
      totalEvents: store.count(),
    });
  });

  app.get('/api/metrics', (req: Request, res: Response) => {
    const filter = extractFilter(req);
    const events = store.query(filter);
    const metrics = computeDashboardMetrics(events, collector.getSourceStatuses());
    res.json(metrics);
  });

  app.get('/api/workflows', (req: Request, res: Response) => {
    const filter = extractFilter(req);
    const events = store.query(filter);
    const workflows = buildWorkflowSummaries(events);
    res.json({ workflows });
  });

  app.get('/api/workflows/:id/graph', (req: Request, res: Response) => {
    const workflowId = decodeURIComponent(String(req.params.id));
    const events = store.query({ workflowId });
    const graph = buildWorkflowGraph(events, workflowId);
    if (!graph) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json(graph);
  });

  app.get('/api/events', (req: Request, res: Response) => {
    const filter = extractFilter(req);
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit ?? 200) || 200));
    const events = store.query(filter);
    const latest = events.slice(-limit).reverse();
    res.json({ events: latest, total: events.length });
  });

  app.get('/api/export', (req: Request, res: Response) => {
    const filter = extractFilter(req);
    const events = store.query(filter);
    const metrics = computeDashboardMetrics(events, collector.getSourceStatuses());
    const workflows = buildWorkflowSummaries(events);
    res.json({
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      filters: filter,
      summary: metrics.kpis,
      byModel: metrics.byModel,
      bySource: metrics.bySource,
      topTools: metrics.topTools,
      insights: metrics.insights,
      workflows,
      events,
    });
  });

  app.post('/api/scan', async (_req: Request, res: Response) => {
    const result = await collector.scanOnce(true);
    res.json({ ok: true, ...result, sources: collector.getSourceStatuses() });
  });

  app.get('/api/config', (_req: Request, res: Response) => {
    const loaded = loadAgentPulseConfig();
    res.json({
      config: loaded.config,
      loadedFrom: loaded.loadedFrom,
      globalConfigPath: getGlobalConfigPath(),
    });
  });

  app.put('/api/config', (req: Request, res: Response) => {
    const incoming = (req.body?.config ?? req.body) as Partial<AgentPulseConfig> | undefined;
    if (!incoming || typeof incoming !== 'object') {
      res.status(400).json({ error: 'Expected config object' });
      return;
    }
    // Overwrite lists cleanly (replace existing arrays rather than only appending)
    const path = getGlobalConfigPath();
    const loaded = loadAgentPulseConfig();
    const next: AgentPulseConfig = {
      vscodeDirs: Array.isArray(incoming.vscodeDirs) ? incoming.vscodeDirs : loaded.config.vscodeDirs,
      copilotTraceDbs: Array.isArray(incoming.copilotTraceDbs) ? incoming.copilotTraceDbs : loaded.config.copilotTraceDbs,
      copilotChatLogDirs: Array.isArray(incoming.copilotChatLogDirs) ? incoming.copilotChatLogDirs : loaded.config.copilotChatLogDirs,
      claudeDirs: Array.isArray(incoming.claudeDirs) ? incoming.claudeDirs : loaded.config.claudeDirs,
      antigravityDirs: Array.isArray(incoming.antigravityDirs) ? incoming.antigravityDirs : loaded.config.antigravityDirs,
      codexDirs: Array.isArray(incoming.codexDirs) ? incoming.codexDirs : loaded.config.codexDirs,
      port: typeof incoming.port === 'number' ? incoming.port : loaded.config.port,
      pollIntervalMs: typeof incoming.pollIntervalMs === 'number' ? incoming.pollIntervalMs : loaded.config.pollIntervalMs,
    };
    replaceGlobalConfig(next);
    res.json({ ok: true, savedTo: path, config: next });
  });

  // Simple HTTP JSON ingest for any custom model / agent script
  app.post('/api/ingest', (req: Request, res: Response) => {
    const body = req.body as SimpleIngestEvent | SimpleIngestEvent[] | { events?: SimpleIngestEvent[] };
    const rawItems =
      body && typeof body === 'object' && 'events' in body && Array.isArray(body.events)
        ? body.events
        : (body as SimpleIngestEvent | SimpleIngestEvent[]);

    if (!rawItems || (Array.isArray(rawItems) && rawItems.length === 0)) {
      res.status(400).json({ error: 'Expected event object or { events: [...] }' });
      return;
    }
    const normalized = normalizeSimpleIngest(rawItems);
    const added = store.upsert(normalized);
    res.status(202).json({ accepted: normalized.length, stored: added.length });
  });

  // Standard OpenTelemetry OTLP/JSON trace receiver
  app.post('/v1/traces', (req: Request, res: Response) => {
    const events = parseOtlpTraces(req.body);
    const added = store.upsert(events);
    res.status(200).json({ partialSuccess: {}, accepted: events.length, stored: added.length });
  });

  // Multi-agent simulation controls
  app.post('/api/simulate', (req: Request, res: Response) => {
    const instant = Boolean(req.body?.instant);
    const scenarioIndex =
      typeof req.body?.scenarioIndex === 'number' ? req.body.scenarioIndex : undefined;
    const result = streamSimulatedWorkflow(store, { instant, scenarioIndex });
    res.status(202).json({ ok: true, ...result });
  });

  app.delete('/api/simulate', (_req: Request, res: Response) => {
    const removed = store.clearSimulated();
    res.json({ ok: true, removed });
  });

  // Track active SSE streams and cap to 3 so HTTP/1.1 browsers (6-socket limit per origin)
  // ALWAYS retain free sockets for page refreshes, assets, and API calls.
  const activeSseClients = new Set<Response>();
  const MAX_SSE_CLIENTS = 3;

  // Real-time SSE stream for live dashboard updates
  app.get('/api/stream', (req: Request, res: Response) => {
    while (activeSseClients.size >= MAX_SSE_CLIENTS) {
      const oldest = activeSseClients.values().next().value;
      if (!oldest) break;
      activeSseClients.delete(oldest);
      try {
        oldest.end();
      } catch {
        // ignore
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    activeSseClients.add(res);

    res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    const unsubscribe = store.subscribe((added) => {
      if (res.writableEnded) return;
      res.write(`event: update\ndata: ${JSON.stringify({ count: added.length, ts: Date.now() })}\n\n`);
    });

    const keepAlive = setInterval(() => {
      if (res.writableEnded) return;
      res.write(`: ping\n\n`);
    }, 20_000);

    const cleanup = () => {
      clearInterval(keepAlive);
      unsubscribe();
      activeSseClients.delete(res);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  // Serve built React dashboard when available
  const resolvedWebDist = webDistDir ?? join(__dirname, '..', 'web', 'dist');
  if (existsSync(resolvedWebDist)) {
    app.use(
      express.static(resolvedWebDist, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store');
          }
        },
      }),
    );
    app.get('/{*splat}', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(join(resolvedWebDist, 'index.html'));
    });
  }

  return app;
}

export function startServer(
  deps: ServerDeps,
  port = 4318,
  host = '127.0.0.1',
): Promise<{ server: Server; url: string }> {
  const app = createApp(deps);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      resolve({ server, url });
    });
    server.on('error', reject);
  });
}
