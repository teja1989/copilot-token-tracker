# copilot-token-tracker

Local-first VS Code Copilot Chat/Agent usage tracker. See [`PLAN.md`](./PLAN.md) for full
design rationale, the schema verification against two reference implementations, and the
phased roadmap — including a correction of an earlier wrong claim, worth reading.

## Status: not yet installable as a VS Code extension

**What exists**: a tested, standalone TypeScript library that reads Copilot Chat's local
trace data, normalizes it, estimates cost, and stores aggregates. Zero VS Code dependency
so far — it's plain Node, runnable and testable on its own (that's deliberate: get the
data model right before building UI on top of it).

**What's missing before this can be installed in VS Code** (all Phase 2, not started):

- [ ] `package.json` extension manifest fields (`engines.vscode`, `main`, `activationEvents`, `contributes`)
- [ ] An actual extension entry point (`src/extension.ts` with `activate()`/`deactivate()`)
- [ ] A file watcher wired to `agent-traces.db` so the extension notices new data without polling forever
- [ ] Any UI at all — status bar item, sidebar, or dashboard webview
- [ ] `.vscodeignore` + packaging via `@vscode/vsce` into a `.vsix`
- [ ] Manual verification by loading the unpacked extension in an Extension Development Host (`F5` in VS Code) before trusting a packaged `.vsix`

None of this is hard given what's already built — the hard part (figuring out where the
real data lives and what it actually contains) is done and tested. But "not started" is
the honest answer to "can I install this today": no.

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
npm run build
npm run inspect:traces   # smoke test against your real local data
```

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
