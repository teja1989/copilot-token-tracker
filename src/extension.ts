import * as vscode from 'vscode';
import { findExistingTracesDbPath } from './ingest/vscodePaths.js';
import { readTraceSpansFromFile } from './ingest/tracesDb.js';
import { UsageDb, type ModelAggregate, type AgentAggregate } from './storage/db.js';

const REFRESH_INTERVAL_MS = 30_000;
const PERSIST_FILENAME = 'usage.sqlite';

let usageDb: UsageDb | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let currentPanel: vscode.WebviewPanel | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let outputChannel: vscode.OutputChannel | undefined;

interface DashboardPayload {
  dbFound: boolean;
  byModel: ModelAggregate[];
  byAgent: AgentAggregate[];
  totals: { requests: number; usdCost: number; premiumUnits: number };
}

function persistUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, PERSIST_FILENAME);
}

function wasmBinaryPath(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.extensionUri, 'dist-ext', 'sql-wasm.wasm').fsPath;
}

async function loadPersistedDb(context: vscode.ExtensionContext): Promise<UsageDb> {
  const wasmPath = wasmBinaryPath(context);
  try {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const bytes = await vscode.workspace.fs.readFile(persistUri(context));
    return UsageDb.load(bytes, wasmPath);
  } catch {
    // No prior data (first run, or file not found) — that's normal, not an error.
    return UsageDb.load(undefined, wasmPath);
  }
}

async function persistDb(context: vscode.ExtensionContext, db: UsageDb): Promise<void> {
  await vscode.workspace.fs.writeFile(persistUri(context), db.exportBytes());
}

function buildPayload(db: UsageDb, dbFound: boolean): DashboardPayload {
  const byModel = db.aggregateByModel();
  const byAgent = db.aggregateByAgent();
  const totals = byModel.reduce(
    (acc, m) => ({
      requests: acc.requests + m.requestCount,
      usdCost: acc.usdCost + m.totalUsdCost,
      premiumUnits: acc.premiumUnits + m.totalPremiumRequestUnits
    }),
    { requests: 0, usdCost: 0, premiumUnits: 0 }
  );
  return { dbFound, byModel, byAgent, totals };
}

function updateStatusBar(payload: DashboardPayload): void {
  if (!statusBarItem) return;
  if (!payload.dbFound) {
    statusBarItem.text = '$(circle-slash) Copilot: no data yet';
    statusBarItem.tooltip = 'agent-traces.db not found yet — use Copilot Chat or Agent Mode, then this will populate.';
    return;
  }
  const costPart =
    payload.totals.usdCost > 0
      ? `$${payload.totals.usdCost.toFixed(2)}`
      : payload.totals.premiumUnits > 0
        ? `${payload.totals.premiumUnits.toFixed(1)}x premium`
        : null;
  statusBarItem.text = `$(zap) Copilot: ${payload.totals.requests} req${costPart ? ` · ${costPart}` : ''}`;
  statusBarItem.tooltip = 'Click to open the Copilot Token Tracker dashboard';
}

async function refresh(context: vscode.ExtensionContext): Promise<void> {
  if (!usageDb) return;
  const dbPath = findExistingTracesDbPath();

  if (!dbPath) {
    const payload = buildPayload(usageDb, false);
    updateStatusBar(payload);
    currentPanel?.webview.postMessage({ type: 'usageData', payload });
    return;
  }

  const sinceMs = usageDb.getLatestTimestampMs() ?? undefined;
  const { results, excludedAggregateRollups } = await readTraceSpansFromFile(dbPath, sinceMs);

  let ingested = 0;
  let warned = 0;
  for (const result of results) {
    if (result.event) {
      if (result.event.kind === 'chat') usageDb.insertChatEvent(result.event);
      else usageDb.insertToolCallEvent(result.event);
      ingested += 1;
    } else {
      warned += 1;
    }
  }

  outputChannel?.appendLine(
    `[refresh] read=${results.length} ingested=${ingested} warnings=${warned} excludedRollups=${excludedAggregateRollups}`
  );

  await persistDb(context, usageDb);

  const payload = buildPayload(usageDb, true);
  updateStatusBar(payload);
  currentPanel?.webview.postMessage({ type: 'usageData', payload });
}

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));
  const chartUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chart.umd.js'));
  const mainUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  const n = nonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}' ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Copilot Token Tracker</title>
</head>
<body>
  <div id="empty-state" class="hidden">
    <p>No usage data yet. Use Copilot Chat or Agent Mode, then this dashboard will populate automatically.</p>
  </div>
  <div id="content">
    <div class="stat-row">
      <div class="stat-card"><div class="stat-label">Requests</div><div class="stat-value" id="stat-requests">—</div></div>
      <div class="stat-card"><div class="stat-label">Est. cost</div><div class="stat-value" id="stat-cost">—</div></div>
      <div class="stat-card"><div class="stat-label">Premium units</div><div class="stat-value" id="stat-premium">—</div></div>
    </div>
    <div class="chart-row">
      <div class="chart-container"><h3>By model</h3><canvas id="model-chart"></canvas></div>
      <div class="chart-container"><h3>By agent / surface</h3><canvas id="agent-chart"></canvas></div>
    </div>
  </div>
  <script nonce="${n}" src="${chartUri}"></script>
  <script nonce="${n}" src="${mainUri}"></script>
</body>
</html>`;
}

function openDashboard(context: vscode.ExtensionContext): void {
  if (currentPanel) {
    currentPanel.reveal();
    return;
  }
  currentPanel = vscode.window.createWebviewPanel(
    'copilotTokenTracker',
    'Copilot Token Tracker',
    vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] }
  );
  currentPanel.webview.html = getWebviewHtml(currentPanel.webview, context.extensionUri);
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
  });
  currentPanel.webview.onDidReceiveMessage((message: { type?: string }) => {
    if (message?.type === 'requestData') {
      void refresh(context);
    }
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Copilot Token Tracker');
  context.subscriptions.push(outputChannel);

  usageDb = await loadPersistedDb(context);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'copilotTokenTracker.openDashboard';
  statusBarItem.text = '$(sync~spin) Copilot Token Tracker';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('copilotTokenTracker.openDashboard', () => openDashboard(context))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('copilotTokenTracker.refresh', () => refresh(context))
  );

  await refresh(context);
  refreshTimer = setInterval(() => void refresh(context), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
}

export function deactivate(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  usageDb?.close();
  usageDb = undefined;
}
