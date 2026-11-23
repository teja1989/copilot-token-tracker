# AgentPulse — Local Multi-Model Token & Multi-Agent Telemetry Observatory

A **100% local-first**, IDE-agnostic observability platform that tracks **token usage, prompt cache savings, estimated spend, latency, and multi-agent collaboration graphs** across GitHub Copilot, Claude Code, Antigravity, OpenAI Codex CLI, and any custom model/agent framework via OpenTelemetry (OTLP) or HTTP JSON.

---

## Key Capabilities

- **Zero-Config Local Auto-Discovery**: Automatically scans macOS, Linux, and Windows local storage for:
  - **GitHub Copilot (VS Code / Insiders / VSCodium / Cursor / Windsurf)** — `agent-traces.db` (excluding conversation rollup rows to avoid double counting), `chatSessions/*.json` & `*.jsonl` (workspace + empty-window), `GitHub Copilot Chat.log`, and `~/.copilot/`
  - **Claude Code** — `~/.claude/projects/*/*.jsonl` and nested `subagents/agent-*.jsonl` (prompt cache reads/writes, tool calls, and automatic parent-child subagent trees)
  - **Antigravity** — `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl` (including cross-conversation subagent linking)
  - **OpenAI Codex CLI** — `~/.codex/sessions/**/*.jsonl` (including reasoning tokens)
- **Universal OTLP & SDK Ingest**:
  - `POST /v1/traces` — Standard OpenTelemetry OTLP/JSON receiver (`gen_ai.*` & OpenInference `llm.*` attributes)
  - `POST /api/ingest` — Lightweight HTTP JSON endpoint for LangGraph, CrewAI, AutoGen, OpenAI, Anthropic, Gemini, or Ollama scripts
- **Interactive Multi-Agent Topology & Trace Waterfall**:
  - Layered topological **Agent Collaboration DAG** with animated token-flow pulses, **Critical Path** highlight, **Parallelism / Delegation Depth / Handoff Ledger**, and docked Span Inspector
  - **Execution Trace Waterfall** with idle-gap compression, **Trace Steps** & **By Agent** views, and agent/tool filters
- **Material Light & Dark Mode + One-Click JSON Export**:
  - Airy Material Light Mode (default) with instant Dark Mode toggle, Performance Rings, Token Composition bar, Activity Intensity heatmap, and one-click **Export** modal to preview, copy, or download telemetry JSON.
- **Built-In Multi-Agent Simulation Mode**:
  - Click **Simulate Agent Swarm** in the dashboard (or start with `--demo`) to stream a realistic multi-agent workflow live over Server-Sent Events (SSE) and explore all visualizations immediately.
- **100% Local & Private**:
  - Binds to `127.0.0.1` by default and persists normalized metadata locally in `~/.agentpulse/telemetry.jsonl`. No prompts, source code, or telemetry leave your machine.

---

## Quick Start (Zero-Typing Team Launcher)

Requires **Node.js >= 20** (zero native C++ build dependencies).

1. **Double-click to launch (recommended for teammates)**:
   - **macOS**: Double-click `start.command` in Finder (first time: right-click → Open if Gatekeeper prompts)
   - **Windows**: Double-click `start.bat` in File Explorer
   - **Any OS (Terminal)**: `npm run launch` (or `make launch`)

   The interactive launcher shows live daemon status and lets you **Start in Background**, **Stop**, view **Status & Logs**, configure custom local paths, or run diagnostics with a single keypress.

2. **Background Daemon via `make` or `npm` (macOS / Linux / Windows)**:

```bash
make install      # Auto-install dependencies & build server + dashboard
make start        # Start AgentPulse in the background & open dashboard
make status       # Check PID, port, uptime, and total spans
make logs         # View recent logs (including Models Identified)
make stop         # Stop the background daemon cleanly
make restart      # Restart the background daemon
```

*(On Windows PowerShell without `make`, use the equivalent npm scripts: `npm run setup`, `npm run daemon:start`, `npm run daemon:status`, `npm run daemon:logs`, `npm run daemon:stop`.)*

Or install the `agentpulse` CLI globally on your machine:

```bash
npm link
agentpulse start            # Starts on http://127.0.0.1:4318
agentpulse start --demo     # Seeds two realistic multi-agent workflows on startup
agentpulse start --port 4400 --no-open
```

---

## Connecting Custom Agents & Frameworks

### OpenTelemetry (LangGraph, CrewAI, AutoGen, OpenLLMetry)
```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="http://127.0.0.1:4318/v1/traces"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/json"
```

### Direct HTTP JSON (`POST /api/ingest`)
```bash
curl -X POST http://127.0.0.1:4318/api/ingest \
  -H "Content-Type: application/json" \
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
  }'
```

---

## Custom Local Paths & Configuration

If your work laptop uses a corporate, portable, or non-default VS Code / AI tool directory, you can configure custom paths in **three ways** (all are merged automatically):

### Option A: Interactive Menu (No JSON Editing Needed)
Run `start.command` (macOS) or `start.bat` (Windows) and select **Option 5 — Configure Custom Local Path**. Paste the folder path and AgentPulse saves it to `~/.agentpulse/config.json`.

### Option B: Config File (`agentpulse.config.json` or `~/.agentpulse/config.json`)
Copy [`agentpulse.config.example.json`](./agentpulse.config.example.json) to `./agentpulse.config.json` (project-local) or `~/.agentpulse/config.json` (user-global):

```json
{
  "vscodeDirs": [
    "C:/Users/YOUR_USER/AppData/Roaming/Code",
    "~/Library/Application Support/Code"
  ],
  "copilotTraceDbs": [],
  "copilotChatLogDirs": [],
  "claudeDirs": [],
  "antigravityDirs": [],
  "codexDirs": [],
  "port": 4318,
  "pollIntervalMs": 10000
}
```

| Field | What to put here |
| --- | --- |
| `vscodeDirs` | VS Code / Insiders / VSCodium / Cursor / Windsurf root or `User` folders (auto-scans `globalStorage`, `workspaceStorage`, and `logs`) |
| `copilotTraceDbs` | Explicit full paths to any `agent-traces.db` SQLite file |
| `copilotChatLogDirs` | Any folder containing `GitHub Copilot Chat.log` or `chatSessions/*.json(l)` files |
| `claudeDirs` | Custom Claude Code `projects` directories |
| `antigravityDirs` | Custom Antigravity `brain` directories |
| `codexDirs` | Custom Codex CLI `sessions` directories |
| `port` / `pollIntervalMs` | Optional defaults for server port (`4318`) and polling interval (`10000` ms) |

> **Tip**: Both `~/` home prefixes and forward slashes (`C:/Users/...`) work cleanly on Windows, macOS, and Linux.

### Option C: Environment Variable Override
- **Windows PowerShell**: `$env:AGENTPULSE_VSCODE_DIR="C:\path\to\Code"`
- **macOS / Linux**: `export AGENTPULSE_VSCODE_DIR="/path/to/Code"`

### Default Locations Scanned Automatically
- **macOS**: `~/Library/Application Support/{Code,Code - Insiders,VSCodium,Cursor,Windsurf}`
- **Windows**: `%APPDATA%\{Code,Code - Insiders,VSCodium,Cursor,Windsurf}` and `%LOCALAPPDATA%\...`
- **Linux**: `~/.config/{Code,Code - Insiders,VSCodium,Cursor,Windsurf}`
- **Cross-platform**: `~/.copilot`, `~/.claude/projects`, `~/.gemini/antigravity/brain`, `~/.codex/sessions`

### Troubleshooting: "VS Code / Copilot Not Detected"
1. Run `start.bat` / `start.command` → **Option 4 (Run Local Diagnostics & Tests)** to see the exact `VS Code root dirs found` and file counts for `traces DB`, `chat sessions`, and `Chat.log`.
2. In VS Code, open the Command Palette → **Developer: Open Extension Logs Folder** to see your exact VS Code logs path, then add its parent `Code` directory via **Option 5** or `vscodeDirs` in `agentpulse.config.json`.
3. Check the startup terminal logs — AgentPulse prints every **Active Source** and every **Model Identified** (with call counts and token totals) as soon as it boots.

---

## Development & Testing

```bash
npm run typecheck   # Type-check both backend and React frontend
npm test            # Run Vitest unit & HTTP integration tests
npm run dev:server  # Watch mode backend on :4318
npm run dev:web     # Vite HMR frontend on :5173 (proxies /api & /v1 to :4318)
```
