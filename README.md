# copilot-token-tracker

Local-first VS Code Copilot Chat/Agent usage tracker. See [`PLAN.md`](./PLAN.md) for full
design rationale, the schema verification against two reference implementations, and the
phased roadmap — including a correction of an earlier wrong claim, worth reading.

## Status: installable `.vsix` exists (v0.1, unverified in a real VS Code window)

**What exists now**: a real extension — status bar item, a "Copilot Token Tracker: Open
Dashboard" command, a webview dashboard (stat cards + two Chart.js charts, by model and
by agent), 30-second polling of `agent-traces.db` with incremental ingestion, and
persistence to the extension's own storage so history survives a VS Code restart. An
optional, off-by-default team-export path (`copilotTokenTracker.export.*` settings) can
send pseudonymized usage metadata to a team-run collector — see
[`docs/mongo-team-rollup.md`](./docs/mongo-team-rollup.md) for the schema, the identity
model, and what's still unbuilt on that side (the wrapper API itself). It
builds and packages cleanly: `npm run package` produces a ~423 KB `.vsix`
(10 files — trimmed from an initial 9.17 MB by bundling `sql.js`'s JS directly and
shipping only the one `.wasm` file it needs instead of that package's full ~23 MB of
build variants).

**What has NOT been verified, stated plainly**: this was built in a sandboxed environment
with no VS Code binary available, so nobody has actually installed this `.vsix` and
clicked around it yet. Bundle-loads-without-crashing was checked (`node -e
"require('./dist-ext/extension.cjs')"` fails only on the intentionally-external `vscode`
module, meaning everything else resolved cleanly), and the underlying data logic has 28
passing tests plus a real-data dry run — but activation, the status bar, and the webview
itself have zero automated coverage and zero manual verification. **You need to install
it and confirm it actually works before trusting it further.**

### Installing it

```
npm install
npm run package          # produces copilot-token-tracker-0.1.0.vsix
code --install-extension copilot-token-tracker-0.1.0.vsix
```

Or in VS Code: Extensions view → `...` menu → "Install from VSIX..." → pick the file.

After installing: look for a status bar item (bottom right) that should read either
"Copilot: no data yet" or "⚡ Copilot: N req"; run **Copilot Token Tracker: Open
Dashboard** from the Command Palette. If Copilot Chat/Agent Mode has been used at all,
`agent-traces.db` should already exist and the dashboard should show real data within the
30-second poll interval (or immediately, since activation triggers one refresh
up front).

**If anything looks wrong** (status bar never updates, dashboard stays empty when you know
you've used Copilot, an error notification appears): open the "Copilot Token Tracker"
output channel (Output panel → dropdown) for `[refresh]` log lines showing read/ingested/
warning counts, and report back what you see — that log line plus what the status bar
shows is enough to diagnose it without needing to share any real data.

### What's still missing for a polished v1 (not blocking basic install/use)

- [ ] Automated tests for `extension.ts` itself (activation, command registration,
      message handling) — everything below it is tested, this glue layer isn't, because
      it's tightly coupled to the `vscode` API and wasn't worth adding
      `@vscode/test-electron` for at this stage.
- [ ] An extension icon (cosmetic; `vsce package` just warns without one).
- [ ] A `LICENSE` file (`vsce package` warns about this too — deliberately not adding one
      without you deciding the terms).
- [ ] Real-time updates instead of a 30-second poll (there's a manual "Refresh Now"
      command in the meantime).
- [ ] Efficiency-insight heuristics (flagging frontier-model-on-trivial-turns, retry
      patterns, etc.) — Phase 2 of `PLAN.md` scoped these; the dashboard currently shows
      raw aggregates only, no recommendations yet.

## Testing this now (before there's an extension to load)

Two layers, both already working:

### 1. Automated tests (fixture-based, no real data needed)

```
npm install
npm run typecheck
npm test
```

26 tests across normalization, the traces-DB reader, and both pricing paths, run against
synthetic fixtures built to match the verified real schema — not against your actual
data. This is what CI would run and is the fast, repeatable layer.

### 2. Smoke test against YOUR real `agent-traces.db`

This is the layer that actually tells you whether the schema assumptions hold on your
machine, not just against synthetic fixtures:

```
npm run inspect:traces
```

This builds the project and runs `tools/inspect-traces-db.mjs` through the real
ingestion/storage code (not a reimplementation) against your actual local database. It
prints **aggregates only** — model names, agent/surface names, token totals, cost
estimates, a count of any rows that failed to normalize — and never touches or prints
prompt/response content or file paths beyond the DB's own location. If a model or agent
name in the output looks wrong, or the row/warning counts look off, that's a real signal
something in the schema assumptions needs fixing — and the printed output is safe to
paste back for debugging, since there's nothing in it that wasn't already an aggregate
number or a model/agent name.

If it reports "No agent-traces.db found," either you haven't used Copilot Chat/Agent mode
enough yet for Copilot to have created it, or your install uses a path this tool doesn't
check yet (pass `--path` to point it at a specific file).

## Data sources

**Primary: `agent-traces.db`.** Copilot Chat maintains this SQLite database itself at
`<VS Code User dir>/globalStorage/github.copilot-chat/agent-traces.db` with no settings
changes required — verified by reading two real open-source extensions' source directly
(see `PLAN.md`), not by guessing. It carries structured token counts (including cache
breakdown), real GitHub-billed credit usage per call when available, and per-turn indices.
`src/ingest/tracesDb.ts` reads it read-only via `sql.js`.

**Fallback: Copilot's documented OTel emission.** Add to your VS Code `settings.json`:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "file",
  "github.copilot.chat.otel.outfile": "/absolute/path/to/copilot-otel.jsonl"
}
```

By default (`captureContent: false`), only metadata is written — model ids, token counts,
durations, no prompt/response text. This project never turns `captureContent` on and
discards those fields if present. `src/ingest/normalize.ts` + `jsonlSource.ts` handle this
path.

## Development

```
npm install
npm run typecheck
npm test
npm run build             # compiles the library to dist/ (used by tools/, not the extension)
npm run inspect:traces    # smoke test against your real local data
npm run build:ext         # bundles src/extension.ts -> dist-ext/extension.cjs + sql-wasm.wasm
npm run package           # runs build:ext, then vsce package -> the installable .vsix
```

`dist/` (plain tsc output, used by `tools/`) and `dist-ext/` (the esbuild-bundled
extension, used by the packaged `.vsix`) are two separate build outputs for two separate
purposes — the `.vsix` does not ship `dist/` at all (see `.vscodeignore`).

## Layout

- `src/model/events.ts` — normalized internal event types (`ChatEvent`, `ToolCallEvent`),
  shared by both ingestion paths.
- `src/ingest/tracesDb.ts` — `agent-traces.db` reader. Excludes the `"GitHub Copilot
  Chat"` rollup span at the SQL level (it duplicates real spans and would double-count
  every total if included).
- `src/ingest/` (attributes/normalize/jsonlSource) — the OTel file/OTLP-exporter fallback
  path: attribute extraction tolerant of both flat-object and OTLP array-of-kv encodings,
  span normalization, and a JSONL reader that fails safe on malformed lines.
- `src/pricing/tokenPricing.ts` — real $/token rates (third-party-sourced, citation and
  caveats in the file). `src/pricing/pricingTable.ts` — legacy per-request multiplier
  table for accounts still on that billing model. `src/pricing/estimateCost.ts` computes
  both independently (never lets one silently override the other — see the docstring for
  why) and prefers real per-span billing data over either when present.
- `src/storage/db.ts` — `sql.js` (WASM SQLite, no native compilation) storage with
  per-model and per-agent aggregate queries.
- `tools/inspect-traces-db.mjs` — the real-data smoke test described above.
- `tools/inspect-copilot-storage.mjs` — an older reconnaissance script for the (now
  secondary) `chatSessions` storage format; kept for the Appendix fallback path in
  `PLAN.md`, not part of the primary pipeline.
- `src/extension.ts` — the actual VS Code extension: activation, status bar, the
  `openDashboard`/`refresh` commands, polling + incremental ingestion, and persistence to
  `context.globalStorageUri`.
- `media/` — the webview's HTML/CSS/JS and a vendored Chart.js UMD build (see
  `media/THIRD_PARTY_NOTICES.md` for its license).
- `scripts/build-extension.mjs` — esbuild bundling for `extension.ts`; bundles `sql.js`'s
  JS directly (not left as an external `node_modules` dependency) and copies only the one
  `.wasm` file actually needed, which is why the packaged `.vsix` is ~423 KB instead of
  the ~9 MB a naive `vsce package` produces when it includes all of `node_modules/sql.js`.
- `src/export/` — the optional team-rollup path (off by default). `pseudonymize.ts` +
  `identity.ts` turn a git email/OS username into a salted, non-reversible id;
  `toExportDocument.ts` maps stored rows to the Mongo-shaped schema in
  `docs/mongo-team-rollup.md`; `sink.ts` defines a swappable `ExportSink` (`HttpBatchSink`
  is the concrete default, `NullSink` for tests); `exportManager.ts` orchestrates reading
  unexported rows and only advancing the export watermark on success.

## Known open items

- The `file`-exporter JSONL shape (fallback path) hasn't been validated against a real
  captured sample. `src/ingest/attributes.ts` supports both plausible encodings so only
  that file needs to change if reality differs.
- Both pricing tables are third-party-sourced, not independently verified against
  docs.github.com directly (unreachable from the dev environment this was built in) —
  see the docstrings in `src/pricing/pricingTable.ts` and `tokenPricing.ts`.
- `cache_write_tokens` is confirmed absent from the current `agent-traces.db` schema
  version; always `null` from that path.
- No VS Code extension manifest/activation yet — see the Status checklist above.
