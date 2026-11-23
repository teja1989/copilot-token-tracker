# AgentPulse — Local Multi-Model Token & Multi-Agent Telemetry Observatory

A **100% local-first**, IDE-agnostic observability platform that tracks **token usage, prompt cache savings, estimated spend, latency, and multi-agent collaboration graphs** across GitHub Copilot, Claude Code, Antigravity, OpenAI Codex CLI, and any custom model/agent framework via OpenTelemetry (OTLP) or HTTP JSON.

---

## Key Capabilities

- **Zero-Config Local Auto-Discovery**: Automatically scans macOS, Linux, and Windows local storage for:
  - **GitHub Copilot (VS Code / Insiders / Cursor)** — `agent-traces.db` (excluding conversation rollup rows to avoid double counting) + `workspaceStorage/*/chatSessions/*.json`
  - **Claude Code** — `~/.claude/projects/*/*.jsonl` (including prompt cache reads/writes, tool calls, and sidechain subagents)
  - **Antigravity** — `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl` (including `invoke_subagent` delegations)
  - **OpenAI Codex CLI** — `~/.codex/sessions/**/*.jsonl`
- **Universal OTLP & SDK Ingest**:
  - `POST /v1/traces` — Standard OpenTelemetry OTLP/JSON receiver (`gen_ai.*` & OpenInference `llm.*` attributes)
  - `POST /api/ingest` — Lightweight HTTP JSON endpoint for LangGraph, CrewAI, AutoGen, OpenAI, Anthropic, Gemini, or Ollama scripts
- **Interactive Multi-Agent Swarm Visualizer**:
  - Layered topological **Agent Collaboration DAG** with animated token-flow pulses on handoff edges
  - Toggleable **Critical Path** bottleneck highlight
  - Click any agent node to inspect its exact model calls, tool invocations, token breakdown, and errors
  - Synchronized **Multi-Agent Execution Waterfall (Swimlane Gantt)** showing parallel vs. sequential agent work
- **AI FinOps & Efficiency Insights**:
  - Automated heuristics flag frontier models used on trivial turns, low prompt cache hit rates, retry/error loops, context window bloat, and p95 latency tails — with estimated monthly savings.
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
   - **Any OS (Terminal)**: `npm run launch` (or `node scripts/launch.mjs`)

   The interactive launcher automatically installs dependencies, builds the dashboard on first run, and lets you start Live Local mode, Demo Multi-Agent Swarm mode, Custom Port, or Diagnostics with a single keypress.

2. **Manual CLI setup**:

```bash
git clone https://github.com/teja1989/copilot-token-tracker.git
cd copilot-token-tracker

# Install root + dashboard dependencies and build
npm install
npm --prefix web install
npm run build

# Start the local observatory (auto-discovers local AI logs & opens dashboard)
npm start
```

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

### Custom Local Paths Configuration
If your work laptop stores VS Code, Copilot, Claude, or Codex logs in a non-default directory, copy [`agentpulse.config.example.json`](./agentpulse.config.example.json) to `agentpulse.config.json` (or `~/.agentpulse/config.json`) — or choose **Option 5 (Configure Custom Local Path)** in `start.command` / `start.bat`:

```json
{
  "vscodeDirs": ["C:/Users/YOUR_USER/AppData/Roaming/Code"],
  "copilotChatLogDirs": [],
  "claudeDirs": [],
  "codexDirs": []
}
```

---

## Development & Testing

```bash
npm run typecheck   # Type-check both backend and React frontend
npm test            # Run Vitest unit & HTTP integration tests
npm run dev:server  # Watch mode backend on :4318
npm run dev:web     # Vite HMR frontend on :5173 (proxies /api & /v1 to :4318)
```
