# copilot-token-tracker

Local-first VS Code Copilot Chat/Agent usage tracker. Primary data source is Copilot
Chat's own local trace database (`agent-traces.db`), with Microsoft's documented
OpenTelemetry span emission kept as a tested fallback. See [`PLAN.md`](./PLAN.md) for the
full design rationale, the schema verification against two reference implementations, and
the phased roadmap — including a correction of an earlier wrong claim about where this
data comes from, which is worth reading if you only read one section.

## Status

Phase 1 (span ingestion + normalization core) is implemented and tested, covering both
data sources. There is no VS Code extension UI yet — this is a standalone, testable core
library that Phase 2 will wrap in an actual extension.

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

## Known open items

- The `file`-exporter JSONL shape (fallback path) hasn't been validated against a real
  captured sample. `src/ingest/attributes.ts` supports both plausible encodings so only
  that file needs to change if reality differs.
- Both pricing tables are third-party-sourced, not independently verified against
  docs.github.com directly (unreachable from the dev environment this was built in) —
  see the docstrings in `src/pricing/pricingTable.ts` and `tokenPricing.ts`.
- `cache_write_tokens` is confirmed absent from the current `agent-traces.db` schema
  version; always `null` from that path.
- No VS Code extension manifest/activation yet (Phase 2).
