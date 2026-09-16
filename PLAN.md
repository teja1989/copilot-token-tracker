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

**Known gaps in the documented OTel spec specifically** (corrected below — some of these
turned out to be wrong once a real reference implementation was inspected):
- Requires a Copilot Chat extension version recent enough to have this feature. Phase 0
  verified this works on the current install.

## Correction + verified richer source: `agent-traces.db`

I was wrong earlier in this document (and out loud, in conversation) to say a competing
extension's "SQLite `agent-traces.db`" was that extension's own cache rather than
something Copilot writes. I checked by directly reading the source of two real, shipped,
MIT-licensed VS Code extensions that already solve this problem —
[`Hoxlegion/copilot-cost-tracker-vsc`](https://github.com/Hoxlegion/copilot-cost-tracker-vsc)
(full source available) and
[`assaelaz/copilot-cost-token-tracker`](https://github.com/assaelaz/copilot-cost-token-tracker)
(the extension actually named "Copilot Cost & Token Tracker" — design specs available,
implementation source was deliberately removed from the public repo by its author, so
only its specs/README were used, not any withdrawn code) — rather than continuing to
guess. Both confirm: Copilot Chat itself writes a real SQLite database at

```
<VS Code User dir>/globalStorage/github.copilot-chat/agent-traces.db
```

This is a single **global** file, shared across every workspace open on the machine (not
per-workspace like `chatSessions`), with `spans` and `span_attributes` tables. Verified
columns on `spans`: `span_id, trace_id, parent_span_id, name, start_time_ms, end_time_ms,
status_code, operation_name, provider_name, agent_name, conversation_id, request_model,
response_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, tool_name,
chat_session_id, turn_index, ttft_ms`. `span_attributes` is a key/value table carrying
sparser per-span extras, most importantly `copilot_chat.copilot_usage_nano_aiu` — **real,
GitHub-reported credit consumption for that exact span** (nano AIU ÷ 1e9 = USD credits).

This corrects two things stated above as gaps:
- **Cost is not a gap.** When `copilot_chat.copilot_usage_nano_aiu` is present, that's
  GitHub's own billing figure for that call, not an estimate. Our cost estimator now
  prefers this over any table lookup whenever it's available (`src/pricing/estimateCost.ts`).
- **Cache tokens are not a gap either** — `cached_tokens` is a real column. `cache_write_tokens`
  genuinely is absent from this schema version (confirmed by both reference readers
  hardcoding it), so that specific gap stands.
- There's also a real, cited **$/token pricing table** ("GitHub Docs 'Models and pricing
  for GitHub Copilot', 2026-06-03" per the reference implementation's own comment) for
  when real credits aren't present — see `src/pricing/tokenPricing.ts`. Still flagged as
  third-party-sourced, not independently verified against docs.github.com directly (that
  domain is unreachable from this environment).

One correctness-critical detail that would silently double every total if missed:
Copilot emits a rollup span with `agent_name` exactly `"GitHub Copilot Chat"` at the
conversation level, which duplicates the real per-surface spans underneath it and never
carries the real-billing attribute. `src/ingest/tracesDb.ts` excludes it at the SQL
`WHERE` level, not after fetching.

**Partial correction on inline completions being fully out of scope**: `agent_name` values
observed in the reference implementation's label map include `XtabProvider` ("Next Edit
Suggestions") alongside `panel/editAgent` ("Inline Chat"), `summarizeConversationHistory`,
`progressMessages`, and `title`. So VS Code's multi-line "Next Edit Suggestions" feature
*is* tracked here — the earlier blanket claim that inline completion activity has zero
accessible signal was too broad. Classic single-line ghost-text completions still aren't
covered by anything found so far.

This DB is populated without the user ever touching `github.copilot.chat.otel.*`
settings — it appears to be Copilot's own always-on internal trace store, distinct from
(though likely sourced from the same underlying span data as) the documented, opt-in OTel
exporter settings above. Practically: **`agent-traces.db` is now the primary ingestion
target** (`src/ingest/tracesDb.ts`, implemented), with the OTel file/OTLP exporter path
(`src/ingest/normalize.ts` + `jsonlSource.ts`, also implemented) kept as a documented,
tested fallback for whichever surfaces only emit through that path, or for accounts where
the DB doesn't exist. A third source exists in the debug-logs JSONL format
(`main.jsonl`/`runSubagent-*.jsonl`, per the assaelaz specs) with per-turn/per-call
granularity the DB doesn't fully expose (e.g. explicit turn/call sequencing with
summarization detection) — not yet implemented, noted here as a possible Phase 2+ addition
if the DB's `turn_index` column proves insufficient for the deep-dive-style view.

## Honest comparison of all three sources now in play

Worth being direct that `agent-traces.db` (our primary source, per the correction above)
is itself undocumented — it is not the public OTel contract this plan originally led
with. The three sources sit on a real spectrum, not a clean "documented good, scraped bad"
split:

| | `chatSessions` (v1, rejected) | `agent-traces.db` (primary, implemented) | OTel file/OTLP exporter (fallback, implemented) |
|---|---|---|---|
| Contract | None; UI-persistence format that already changed shape once (flat `.json` → `.jsonl` mutation log) | None; internal trace store, but a clean columnar SQLite schema, not a mutation log | Public, documented, versioned by Microsoft |
| Stability | Fragile, no external users to catch regressions | Two independent published extensions depend on this exact schema today, which at least means breakage gets noticed fast | Explicit monitoring feature with its own docs page |
| Data richness | Full conversation content, no structured cost/token fields | Structured tokens including cache breakdown, real billing credits, turn index | Standard `gen_ai.*` fields only; no cache or real-credit data found |
| Requires user setup | No | No — populated by default | Yes — three settings |
| Team rollup | Would require inventing a transport ourselves | Same — no built-in remote export | **Built in** — point `otlpEndpoint` at any OTLP collector, including one your team may already run |
| Privacy default | Whatever's on disk, including in-chat code | Metadata + real billing figures only, per what's been inspected so far | Off by default; metadata-only unless `captureContent` is explicitly turned on |

Net effect on the plan: we get richer, more useful data than the original OTel-only design
promised, at the cost of depending on one more undocumented (but externally-validated and
structurally stable-looking) surface. The OTel path stays implemented and tested as a
fallback specifically because it's the one part of this stack with an actual stability
guarantee from Microsoft.

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

### Phase 2 — Local extension MVP — MVP BUILT, UNVERIFIED IN A REAL VS CODE WINDOW

Built: activation, a status bar item, `openDashboard`/`refresh` commands, 30-second
polling of `agent-traces.db` with incremental (`sinceMs`-watermarked) ingestion,
persistence of the `UsageDb` to `context.globalStorageUri` so history survives a restart,
and a webview dashboard (stat cards + per-model and per-agent Chart.js bar charts). See
`src/extension.ts` and `media/`.

**Not done from the original scope of this phase**: trend-over-time charting (currently
aggregate-to-date only, no time-series view), and the efficiency-signal heuristics listed
below — the dashboard shows raw aggregates, not recommendations, so far. Also not done:
any automated test coverage for `extension.ts` itself (see README "Known open items") —
everything it calls into is tested, the activation/wiring layer isn't.

Efficiency signals still to build (not started):
  - Agent/mode defaulting to a frontier model on turns with small token counts — flag as
    a candidate for pinning to a cheaper model.
  - Sessions with many chat spans per `conversation.id` relative to output size (prompt
    quality signal).
  - Tool-call error rate per agent (`error.type` present) — wasted round-trips.

Still entirely local, no network, in this phase — confirmed true of what's actually built,
not just the plan: `refresh()` in `extension.ts` only ever touches the local
`agent-traces.db` file and `context.globalStorageUri`.

### Phase 3 — Packaging for team install — PARTIALLY DONE

Done: `.vsix` packaging via `npm run package` (esbuild bundle + `vsce package`), trimmed
to ~418 KB by bundling `sql.js`'s JS directly instead of shipping its full ~23 MB package
(see `scripts/build-extension.mjs`).

Not done:
- Versioned releases / a release process.
- The settings-write helper for `github.copilot.chat.otel.*` — moot for now since the
  primary data source (`agent-traces.db`) needs no settings changes; would only matter if
  Phase 0's OTel fallback path becomes load-bearing.
- A privacy note bundled *inside* the extension UI itself (README covers this, but a
  teammate installing the `.vsix` directly won't necessarily read the README first).
- CI. Tests run locally (`npm test`) but nothing runs them automatically on push yet.

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

- **User identity in the telemetry, checked directly against Microsoft's own docs**: no
  GitHub username, account id, email, machine id, or workspace/repo path in default
  span/resource attributes. Microsoft's own monitoring docs state it explicitly: "No PII
  in default attributes." Two opaque correlation ids do exist — `session.id` (per VS Code
  window) and `gen_ai.conversation.id` (per conversation) — neither carries identity, but
  in a small team, correlating their timestamps against other known activity could
  theoretically re-identify a person. Not a designed risk, worth remembering if this data
  is ever pooled. `enduser.id`/`enduser.pseudo.id` exist in the broader OTel spec for apps
  that want to tag end-user identity — unconfirmed whether Copilot's implementation
  populates either, since no real captured span has been checked yet. If a fixture sample
  ever surfaces one, treat it as PII and exclude it from normalization, don't just pass it
  through because the schema happens to offer it.
- Org admins can inject custom resource attributes (`team.id`, `department`, etc.) via
  `OTEL_RESOURCE_ATTRIBUTES` for org-wide export, and GitHub shipped enterprise-managed
  OTel export (pinned endpoint + resource attributes + content-capture policy, centrally
  configured) in July 2026. Both are admin-opt-in, not something Copilot adds unprompted —
  and if the org ever turns on enterprise-managed export, that becomes the real Phase 4
  team-rollup path instead of anything we'd build ourselves.
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
