# Copilot Usage & Efficiency Tracker — Plan

## Scope (agreed)

- **Personal-first architecture**, packaged for team install from day one (no hardcoded
  personal paths, no dev-only assumptions).
- **Data source: local Copilot Chat session storage** (undocumented VS Code files), not
  the official GitHub Copilot metrics API — no org admin access is available, and that
  API is aggregate-only/admin-gated anyway (see "Why not the official API" below).
- **Covers Chat, Agent Mode, and custom agents/chat-modes only.** Inline tab-completions
  are explicitly out of scope: they're ephemeral requests never written to disk, so there
  is no accessible usage signal for them, official or not. If this changes later, the only
  option is heuristic estimation (character-count proxies) with low confidence — not worth
  building until the rest of this is proven out.
- **No true token counts should be assumed to exist** until Phase 0 proves otherwise.
  Copilot Chat's local storage may contain request/response counts, model IDs, and timing,
  but whether it contains actual token counts (vs. us estimating via a tokenizer) is
  unverified. The plan is written so this resolves in Phase 0, not assumed away.

## Why not the official GitHub API

The Copilot Usage Metrics API (org/enterprise) requires org-owner/billing-manager/
enterprise-admin rights and the "Copilot usage metrics" policy enabled. It reports daily
aggregates (active users, suggestions/acceptances, model adoption) — never per-token,
never per-conversation, and not callable by an individual contributor for themselves. Since
no admin access exists here, it's not load-bearing for v1. It stays a candidate,
feature-flagged input for a later team-rollup phase if/when the org's admin picks it up.

## Why local files, and the risk that comes with it

`workspaceStorage/<hash>/chatSessions/*.json` and `state.vscdb` (SQLite) are where VS
Code persists Copilot Chat/Agent conversations, per workspace. This is the *only* source
with per-model, per-agent, per-turn granularity — and it's what every existing Marketplace
"Copilot usage tracker" extension already relies on, because nothing else exists at this
granularity. The cost: it's completely undocumented and unversioned. GitHub can change the
schema on any release without notice, silently breaking the parser for everyone who's
installed it — which is a real operational risk once this is a team-wide install, not just
a personal script. The whole design below exists to contain that risk (schema-version
detection, defensive parsing, loud failure instead of silent wrong numbers, fixture-based
tests pinned to real schema samples).

## Phases

### Phase 0 — Reconnaissance (blocking; nothing below can be designed without this)

Goal: find out what fields *actually* exist before writing a parser against guessed
field names. Deliverable in this commit: `tools/inspect-copilot-storage.mjs`, a
zero-dependency, read-only, local-only Node script that:

- Locates VS Code's `User/workspaceStorage` directory across macOS/Linux/Windows
  (stable + Insiders).
- Walks each workspace's `chatSessions/*.json`, printing a **structural** summary —
  key names, value types, array lengths, enum-like short strings (role, model id,
  status fields) — while redacting anything that looks like prompt/response body text
  (long strings, anything with newlines) so no actual conversation content leaves your
  machine or lands in a paste.
- Reports the existence/size of `state.vscdb` without parsing it yet (SQLite parsing is
  Phase 1 work, only if the JSON files don't carry everything we need).
- Makes zero network calls — you run it, read the output yourself, and paste back
  what you're comfortable sharing (or just tell me the field names you see for
  model ID, request/response token or char counts, agent/mode identifier, and
  timestamps).

This determines everything downstream: whether real token counts exist, whether
agent/chat-mode identity is recorded per turn, and whether the schema differs across
VS Code versions you and your teammates run.

### Phase 1 — Parser core

- A versioned schema-detection layer: fingerprint the JSON shape, map to a known parser,
  and **fail loudly with a clear "unsupported schema version" surface** (status bar
  warning, not a silently-wrong dashboard) when it doesn't match anything known.
- Fixture-based unit tests: every schema variant we've seen gets a redacted sample file
  checked into `tools/fixtures/`, and the parser is tested against all of them on every
  change. This is the main defense against the "breaks silently on a Copilot update"
  risk called out above.
- Output: a normalized internal event model (session, turn, model id, agent/mode id,
  timestamp, token or char counts, tool calls if present) independent of the raw
  on-disk shape, so everything above this layer never touches raw schema again.

### Phase 2 — Local extension MVP

- VS Code extension (TypeScript) that runs the Phase 1 parser against the current
  machine's workspaceStorage on an interval + file-watcher, entirely local, no network.
- Status bar item: rolling today/week token or request estimate.
- Webview dashboard: per-model breakdown, per-agent/chat-mode breakdown, trend over
  time, and a first pass at efficiency signals, e.g.:
  - agents/chat-modes that default to a frontier model for turns that look trivial
    (short prompt, short diff) — a candidate for pinning to a cheaper model
  - sessions with high back-and-forth turn count relative to task size (possible
    prompt-quality issue, not model issue)
  - repeated large-context attachments across turns in the same session (context bloat)
- All processing local; nothing leaves the machine in this phase.

### Phase 3 — Packaging for team install

- `.vsix` packaging, versioned releases, and a short privacy note bundled with the
  extension (what it reads, what it never sends anywhere, how to uninstall/clear its
  cache).
- Settings: telemetry/export **off by default**; anyone who installs it gets the local
  dashboard with zero data leaving their machine unless they explicitly opt in to
  Phase 4.
- CI: run the Phase 1 fixture tests on every change so a schema-breaking release never
  ships silently.

### Phase 4 — Optional team rollup (design pending on one open item)

- Export layer is a pluggable sink (local CSV/JSON first, always available as a
  fallback and for personal historical export regardless of team rollup).
- **Open item:** you said your team has infra in mind for receiving this — I need to
  know what it is (internal API? a database? a spreadsheet? Slack digest?) before
  designing this phase concretely, since it changes the transport, auth, and schema
  I'd build against. Everything in Phases 0–3 works standalone without this.
- Consent model: per-user explicit opt-in, and the export must redact code/prompt
  content — only aggregated counts and identifiers (model, agent, date, counts) ever
  leave a machine, never conversation text.

## Testing strategy

- Parser: fixture-based, one fixture per observed schema version, run in CI.
- Efficiency heuristics: unit-tested against synthetic session data with known "should
  flag" and "should not flag" cases, so heuristic thresholds are regression-tested, not
  vibes.
- Dashboard: golden-file rendering checks once Phase 2 webview exists.
- Manual: install the packaged `.vsix` in a clean VS Code profile before every team
  release, not just `F5` dev host.

## Security posture

- Read-only access to VS Code's own storage; the extension never writes into
  `chatSessions` or `state.vscdb`.
- No network calls anywhere in Phases 0–3.
- Any Phase 4 export redacts conversation content by construction (aggregation happens
  before anything is serialized for transport), and is opt-in, not opt-out.
- Fixture files under `tools/fixtures/` must be scrubbed of real prompt/response text
  before being committed — the inspector script's redaction exists specifically so this
  is safe to do without a manual review step being the only safeguard.

## Immediate next step

Run `node tools/inspect-copilot-storage.mjs` locally and share the output (or just the
field names it surfaces for model id, agent/mode id, and any count-like fields). That
unblocks Phase 1. Also: tell me what the Phase 4 team-rollup destination actually is.
