# Copilot Usage & Efficiency Tracker — Plan (v2: OTel-first)

## Revision note

v1 of this plan (see git history) was built around parsing VS Code's undocumented
`chatSessions/*.json` / `state.vscdb` storage, because that's what every existing
Marketplace "Copilot usage tracker" — including the one you're currently using — relies
on. Further research surfaced something better: **Copilot Chat ships an actual documented
OpenTelemetry monitoring feature** (`github.copilot.chat.otel.*` settings), built on the
public OTel GenAI semantic conventions, not a private storage format. This plan now leads
with that, and keeps the local-storage approach as a documented fallback, not the primary
design.

## Scope (agreed, unchanged)

- Personal-first architecture, packaged for team install from day one.
- Covers **Chat, Agent Mode, and custom agents/subagents only.** Inline tab-completions
  have no accessible usage signal anywhere (OTel or otherwise) — still out of scope.

## Primary data source: Copilot Chat's OpenTelemetry emission

Settings (confirmed against Microsoft's own docs and the `microsoft/vscode-copilot-chat`
repo's monitoring docs):

| Setting | Default | Purpose |
|---|---|---|
| `github.copilot.chat.otel.enabled` | `false` | Turns emission on. Zero overhead when off. |
| `github.copilot.chat.otel.exporterType` | `"otlp-http"` | `otlp-http` \| `otlp-grpc` \| `console` \| `file` |
| `github.copilot.chat.otel.otlpEndpoint` | `http://localhost:4318` | Where OTLP spans go |
| `github.copilot.chat.otel.outfile` | `""` | JSONL output path, `file` exporter only |
| `github.copilot.chat.otel.captureContent` | `false` | Include actual prompt/response text in spans |

**Default behavior is metadata-only and privacy-safe**: no prompt content, responses, or
tool arguments are captured unless `captureContent` is explicitly turned on — a real,
documented opt-in boundary, not something we have to build ourselves.

Span shapes that matter to us:

- **`chat` spans** (one per LLM call): `gen_ai.operation.name="chat"`,
  `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model` (the resolved
  model, e.g. `gpt-4o-2024-08-06`), `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`, `copilot_chat.time_to_first_token`.
- **`execute_tool` spans** (agent-mode tool calls): `gen_ai.tool.name`, `gen_ai.tool.type`
  (`function` vs `extension`/MCP), `gen_ai.tool.call.id`, `error.type` on failure.
- **Agent identity**: `gen_ai.agent.name` (e.g. `copilot`, or a subagent name like
  `Explore`) and `gen_ai.conversation.id` for session correlation. This is exactly the
  "which custom agent is burning tokens" signal you asked for.

**Known gaps in this data, stated plainly:**
- No cache-hit-rate attribute exists in the documented spec. Any tracker (including your
  current one, if it shows this) claiming a cache-hit metric here is estimating, not
  reading a real field — we will not claim this metric.
- Cost / premium-request-multiplier is **not emitted** — GitHub doesn't tell you the price
  of a model in a span. That still has to come from a pricing table we build and version
  ourselves (same approach every competitor uses: `promptTokens/completionTokens × model
  rate table`). This table will need periodic manual updates as GitHub changes pricing —
  called out explicitly as ongoing maintenance, not a one-time build cost.
- Requires a Copilot Chat extension version recent enough to have this feature. Phase 0
  below verifies this on your actual install before anything else is built.

## Why this beats scraping local storage

| | Local storage scraping (v1 plan, competitors' approach) | OTel emission (this plan) |
|---|---|---|
| Contract | None; private UI-persistence format (`chatSessions` moved from flat `.json` to a `.jsonl` mutation log between VS Code versions already) | Public, documented, versioned by Microsoft |
| Stability | Can silently break on any update | Explicit monitoring feature with its own docs page |
| Team rollup | Requires inventing a transport/schema ourselves | **Built in** — point `otlpEndpoint` at any OTLP collector, including one your team may already run (Tempo/Honeycomb/Datadog/etc.) |
| Privacy default | Whatever's already on disk, including any code shown in-chat | Off by default; metadata-only unless explicitly opted into content capture |

We keep a **fallback path** to local-storage parsing (documented in the Appendix) only
for historical backfill of sessions that happened before OTel was turned on — not as the
primary mechanism.

## Phases

### Phase 0 — Verify on a real install (blocking, fast)

Before writing the parser: confirm the feature actually exists and behaves as documented
on the Copilot Chat version you/your team run (this is a recently-documented feature —
version-gating is a real risk, not a formality).

1. In VS Code settings (JSON): set
   ```json
   "github.copilot.chat.otel.enabled": true,
   "github.copilot.chat.otel.exporterType": "file",
   "github.copilot.chat.otel.outfile": "<some path you choose>/copilot-otel.jsonl"
   ```
2. Run a short Copilot Chat exchange and one Agent Mode task that uses a tool.
3. Confirm the file gets created and contains `gen_ai.*` attributes as described above.
4. Report back: does it work, what Copilot Chat extension version you're on, and
   (only if you're comfortable — still not required) whether the attribute names match
   what's documented above.

If this fails to produce data on your version, we pivot Phase 1 to the local-storage
fallback (Appendix) instead — the plan branches cleanly on this one fact, so verifying it
first avoids building the wrong parser.

### Phase 1 — Span ingestion + normalization core — DONE (see `src/`, `test/`)

- A **span ingestion layer** that's transport-agnostic: it consumes a stream of OTel spans
  regardless of whether they arrived by tailing a local JSONL file (personal mode) or via
  an HTTP OTLP receiver (team mode, Phase 4) — same normalization code either way.
- Normalizes raw spans into an internal event model: `{sessionId, timestamp, model,
  inputTokens, outputTokens, agentName, toolCalls[], latencyMs}`.
- Pricing module: versioned model-rate table (JSON, easy to update), maps
  `(model, inputTokens, outputTokens)` → estimated cost / premium-request count. Ships
  with a documented "as of" date since GitHub's pricing changes over time.
- Local storage: SQLite (via `sql.js` or `better-sqlite3`, decide in Phase 1 based on
  cross-platform native-module packaging tradeoffs) for historical aggregation, since raw
  span logs aren't meant to be queried directly long-term.
- Tests: fixture spans (synthetic, matching the documented attribute schema) covering
  normal chat spans, tool-call spans, multi-model sessions, and malformed/missing-field
  spans (fail-safe, not silent-wrong-number).

### Phase 2 — Local extension MVP

- Extension activates the ingestion layer, watches the local exporter output.
- Status bar: rolling today/week token & estimated cost.
- Webview dashboard (built per the dataviz skill once we get here): per-model breakdown,
  per-agent breakdown (this is where custom-agent efficiency becomes visible), trend over
  time, tool-call frequency by agent.
- Efficiency signals, now backed by real fields instead of inferred ones:
  - Agent/mode defaulting to a frontier model on turns with small token counts — flag as
    a candidate for pinning to a cheaper model.
  - Sessions with many chat spans per `conversation.id` relative to output size (prompt
    quality signal).
  - Tool-call error rate per agent (`error.type` present) — wasted round-trips.
- Still entirely local, no network, in this phase.

### Phase 3 — Packaging for team install

- `.vsix` packaging + versioned releases.
- Bundled setup helper: a command that writes the required `github.copilot.chat.otel.*`
  settings into the user's `settings.json` for them (with confirmation — this is a real
  settings write, not read-only, and gets called out to the user before it happens).
- Privacy note bundled with the extension: exactly what's read, what never leaves the
  machine, and how `captureContent` interacts with this tool if a teammate has it on.
- CI runs the Phase 1 fixture tests on every change.

### Phase 4 — Team rollup (now unblocked by the OTel design itself)

Two options, both real, neither requiring us to invent a protocol:

1. **You already run (or can stand up) an OTLP-compatible backend** (Grafana Tempo,
   Honeycomb, Datadog, a plain OTel Collector + ClickHouse, etc.) — point
   `otlpEndpoint` at it directly from each teammate's settings, and we build a
   backend-specific query module for the dashboard to read aggregated data from it.
2. **You don't** — we ship a minimal purpose-built OTLP HTTP receiver (small Node
   service, same span-normalization code as Phase 1, just a different transport) that
   your team deploys wherever's convenient (a container is enough), and every teammate's
   `otlpEndpoint` points at it instead of a local file.

Either way: consent is per-user (each person's `otel.enabled` is their own opt-in), and
`captureContent` stays off by default regardless of destination — team rollup only ever
carries metadata, never prompt/response text, unless someone deliberately overrides both
settings.

## Testing strategy

- Ingestion/normalization: fixture-based unit tests against synthetic spans matching the
  documented schema, plus malformed-input cases.
- Pricing module: unit tests pinning known `(model, tokens) → cost` calculations, with the
  pricing table's "as of" date checked so stale pricing is visible, not silent.
- Efficiency heuristics: synthetic "should flag" / "should not flag" cases, regression
  tested.
- Dashboard: golden-file rendering checks once the webview exists.
- Manual: install the packaged `.vsix` in a clean VS Code profile before every team
  release.

## Security posture

- No network calls in personal mode (Phases 0–3): file-tailing only.
- The extension's own settings-write helper (Phase 3) requires explicit user confirmation
  before touching `settings.json`.
- `captureContent` is never turned on by this extension automatically, ever — if a
  teammate has it on for their own debugging reasons, our ingestion layer should still
  discard `gen_ai.input.messages` / `gen_ai.output.messages` / tool arguments/results
  fields rather than persisting them, so this tool never becomes the reason prompt content
  ends up in a shared team database.
- Phase 4 receiver (if we build one): authenticated ingestion endpoint (not an open
  receiver on the network), and it only ever stores the normalized metadata shape — raw
  span payloads are not retained.

## Appendix — Local-storage fallback (kept from v1, secondary path only)

If Phase 0 shows OTel isn't available on the team's Copilot Chat version, or for
backfilling history from before OTel was enabled, the fallback is parsing
`workspaceStorage/<hash>/chatSessions/*.jsonl` (mutation-log format since VS Code 1.109:
`kind:0` initial snapshot, `kind:1` set, `kind:2` array push, `kind:3` delete; falls back
to flat `.json` on older builds or when `chat.useLogSessionStorage` is `false`).
`tools/inspect-copilot-storage.mjs` (already committed) does read-only, redacted
structural reconnaissance of this format if we need it. This path carries the schema-drift
risk described in v1 and should stay secondary.

## Immediate next step

Do the Phase 0 verification above (5 minutes: two settings, one chat exchange, one agent
task, check the file exists) and tell me: did it work, and what Copilot Chat version are
you on. That's the one fact that decides whether Phase 1 is built against OTel spans or
falls back to the Appendix path.
