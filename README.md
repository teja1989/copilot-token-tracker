# copilot-token-tracker

Local-first VS Code Copilot Chat/Agent usage tracker, built on Copilot Chat's documented
OpenTelemetry GenAI span emission rather than reverse-engineered internal storage. See
[`PLAN.md`](./PLAN.md) for the full design rationale and phased roadmap.

## Status

Phase 1 (span ingestion + normalization core) is implemented and tested. There is no VS
Code extension UI yet — this is a standalone, testable core library that Phase 2 will
wrap in an actual extension.

## Enabling Copilot's OTel emission (required to produce any data to read)

Add to your VS Code `settings.json`:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "file",
  "github.copilot.chat.otel.outfile": "/absolute/path/to/copilot-otel.jsonl"
}
```

By default (`captureContent: false`, which is also the default if you don't set it),
only metadata is written — model ids, token counts, durations. No prompt or response
text. Do not turn `captureContent` on unless you specifically need it for your own
debugging; this project does not need it and does not use it if present (see
`PLAN.md` security posture).

## Development

```
npm install
npm run typecheck
npm test
npm run build
```

## Layout

- `src/model/events.ts` — normalized internal event types (`ChatEvent`, `ToolCallEvent`).
- `src/ingest/` — attribute extraction (tolerates both flat-object and OTLP
  array-of-key-value attribute encodings), span normalization, and a JSONL file reader
  that fails safe on malformed lines instead of aborting ingestion.
- `src/pricing/` — the legacy per-request model-multiplier table and an estimator.
  Explicitly does **not** produce a dollar cost — see the docstring in
  `pricingTable.ts` for why.
- `src/storage/db.ts` — `sql.js` (WASM SQLite, no native compilation) storage with
  per-model and per-agent aggregate queries.

## Known open items

- The exact JSON shape written by the `file` exporter has not been validated against a
  real captured sample yet. `src/ingest/attributes.ts` supports both plausible encodings
  so only that one file needs to change if reality differs from what's documented.
- The pricing table only covers the legacy per-request multiplier billing model, not the
  usage-based AI Credits model GitHub has been rolling out since mid-2026. See
  `src/pricing/pricingTable.ts`.
- No VS Code extension manifest/activation yet (Phase 2).
