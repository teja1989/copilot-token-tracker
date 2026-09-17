# Phase 4 design: MongoDB team rollup

Companion to `PLAN.md`'s Phase 4 section, now that a concrete destination (MongoDB) is
available. This resolves the schema and shows real output against seed data; two
decisions below are still yours (see "Open decisions") before any of this gets wired
into the actual extension.

## Files here

- `seed/sample-events.json` — 28 realistic documents (3 pseudonymous users, 5
  agents/surfaces, 4 models, spanning 3 days) in the schema below.
- `scripts/mongo-aggregations.js` — the real MongoDB aggregation pipelines, ready to run
  against a live collection (`mongosh` or the Node driver).
- `scripts/simulate-aggregations.mjs` — computes the same results in plain JS against
  the seed file, since no MongoDB server is available in the environment this was built
  in. Run with `node scripts/simulate-aggregations.mjs`. Not a production code path —
  exists purely so the numbers below are real, not hypothetical.

## Schema: one collection, discriminated by `kind`

MongoDB's document model makes a single `copilot_usage_events` collection more natural
than SQL's two-table split in `src/storage/db.ts` — a `kind: "chat" | "tool_call"`
discriminator lets both live together, which matters for the "everything this person did
today" queries a team dashboard actually wants:

```jsonc
{
  "_id": "sp_0001",                 // = spanId — natural idempotency key, see below
  "kind": "chat",                   // or "tool_call"
  "orgId": "acme-corp",             // set by the wrapper API/config, not per-event
  "userId": "u_a1f92c",             // identity model: see Open decisions
  "installationId": "ext-7a1c9e02", // per-VS-Code-install id, independent of userId
  "conversationId": "conv_a1_001",
  "chatSessionId": "conv_a1_001",
  "turnIndex": 0,
  "timestampMs": 1768003200000,
  "extensionVersion": "0.1.0",      // for schema-evolution debugging later

  // chat-only:
  "provider": "github",
  "requestedModel": "claude-sonnet-4.6",
  "resolvedModel": "claude-sonnet-4-6-20260201",
  "agentName": "Explore",
  "inputTokens": 3800, "outputTokens": 620, "cachedTokens": 1200, "cacheWriteTokens": null, "reasoningTokens": 0,
  "timeToFirstTokenMs": 540,

  // cost — computed ONCE, locally, by the existing estimateEventCost() logic, and
  // exported as plain numbers. MongoDB never re-derives pricing; see below.
  "realCreditsUsd": 0.0081,         // GitHub's own figure when present, else null
  "usdCost": 0.0081,                // best-available: realCreditsUsd ?? token-rate estimate
  "premiumRequestUnits": 9,         // computed independently — see estimateCost.ts's docstring
  "costSource": "real",             // "real" | "estimated_token_rate" | "estimated_multiplier" | "no_match"

  // tool_call-only: toolName, toolType, toolCallId, errorType, durationMs
}
```

**Why cost is computed client-side, not in a Mongo pipeline**: the model-matching logic
(`src/pricing/modelMatch.ts`, punctuation-stripped substring matching against two
separate tables) already exists, is tested, and would have to be reimplemented in
aggregation-pipeline expressions to run inside Mongo — a second implementation of the
same logic that could drift from the first. Sending the already-computed numbers keeps
Mongo as the analytics layer and the extension as the only place pricing logic lives.

**Idempotency**: `_id = spanId`. A retried export (network blip, extension restart mid-
batch) becomes a safe `updateOne({_id}, {$set: doc}, {upsert: true})` rather than a
duplicate — the same pattern `INSERT OR REPLACE` already gives the local SQLite store.

## What this data can actually answer (real output, not hypothetical)

Run against the 28-document seed set:

**1. Which agent costs the most** (`costAndUsageByAgent`) — `Plan` is the standout: 4
requests, $0.1671, 108 premium units — **~$0.042/request**, roughly 4x `Explore`'s
~$0.011/request. `title` costs effectively nothing (2 requests, $0.0001) — a good
pattern: a trivial task correctly landing on a cheap model.

**2. Model mix per agent** (`modelMixByAgent`) — confirms *why* `Plan` is expensive: it's
100% `claude-opus-4.8`, GitHub's most expensive tier, for every single call. Whether
that's justified depends on what `Plan` actually does — this is the query that turns "an
agent is expensive" into "an agent always reaches for the priciest model," which is the
actionable version of that finding.

**3. Tool-call error rate per agent** (`toolErrorRateByAgent`) — `panel/editAgent` at
33.3% (1 of 3 in this small seed) and `Explore` at 20%. A real deployment would need a
much bigger sample before acting on this, but the query is what turns "this agent feels
flaky" into a number you can track over time.

**4. Cache efficiency per agent** (`cacheEfficiencyByAgent`) — the most interesting
result in the seed set: `panel/editAgent` reuses cached context only **17.6%** of the
time vs. `Explore`'s **64.3%**. `summarizeConversationHistory` at 11.4% is expected (it
summarizes ever-growing fresh context, which is inherently harder to cache) — but
`panel/editAgent`'s low ratio, on a surface that should be resending mostly-unchanged
file context turn to turn, is a legitimate "why isn't this caching better" flag.

**5. Per-user, per-agent leaderboard** (`userAgentLeaderboard`) — needs the identity
decision below before it can ship, but this is the query a team lead actually asks for:
"who's driving the `Plan` cost."

**6. Daily trend per agent** (`dailyCostByAgent`) — the shape a "is this getting worse"
chart needs; not much signal in 3 days of seed data, but the pipeline is real.

## Decisions made, and what got built from them

### 1. Identity model: pseudonymous (option B)

Implemented in `src/export/pseudonymize.ts` and `src/export/identity.ts`: a keyed hash
(HMAC-SHA256, not a bare hash — a bare hash of an email is trivially reversible by
dictionary attack against a list of the org's addresses, which is to say by anyone) of
the person's git `user.email` (falling back to OS username when git isn't configured),
truncated and prefixed `u_`. The hash key (salt) matters more than it might look:

- **An org-wide salt** (`copilotTokenTracker.export.pseudonymSalt`, the same value on
  every teammate's machine) makes the same person's pseudonym stable across their own
  machines — needed for query 5 (the leaderboard) and any per-person trend to mean
  anything.
- **No salt configured** → each machine falls back to its own random salt, persisted
  locally (`resolveExportSalt()` in `extension.ts`) so it's at least stable across
  restarts on that one machine, logged once as a warning. The same person on two
  machines then looks like two different people. This is the default today because no
  org salt exists yet — set one when you're ready for cross-machine trends to work.
- `copilotTokenTracker.export.identity: "anonymous"` skips all of this and sends `userId: null`.

### 2. Send frequency: piggybacked on the existing poll loop, batched, pluggable transport

The wrapper API's real contract (auth scheme, exact request/response shape) still isn't
decided — so `src/export/sink.ts` defines an `ExportSink` interface and ships
`HttpBatchSink` as the concrete default (`POST {endpoint} {"events": [...]}`, chunked at
200 docs, one `authHeader` value sent verbatim). Swapping in whatever the real contract
turns out to be is a one-file change; nothing else in the export path knows which sink
is in use.

Built exactly as planned: `src/storage/db.ts` tracks the export watermark separately
from the local-ingestion watermark (`getExportWatermarkMs`/`setExportWatermarkMs`, its
own tiny table in the same sql.js DB, so it persists for free). `src/export/
exportManager.ts` reads unexported rows, sends them, and advances the watermark **only**
on success — a thrown error from the sink leaves the watermark untouched, so the next
30-second cycle retries the exact same rows, and because every document upserts by
`spanId`, a retried batch is always safe, never a duplicate. `refresh()` in
`extension.ts` calls this and swallows (logs, doesn't rethrow) any export failure so it
can never break local ingestion or the dashboard. A manual "Sync Now" command
(`copilotTokenTracker.syncNow`) re-reads settings and forces a cycle immediately.

Export is **off by default** (`copilotTokenTracker.export.enabled: false`) and does
nothing until both `enabled: true` and a non-empty `endpoint` are set.

## What's NOT built yet

- The wrapper API itself — yours to build. `HttpBatchSink`'s request shape is a
  reasonable default guess, not a confirmed contract; tell me the real one once it
  exists and I'll adjust `sink.ts` to match (should be small).
- Any consent/notice UI shown to a teammate before their machine starts exporting —
  right now it's a settings value, which is enough for an internally-rolled-out team
  tool but not a substitute for actually telling people what turning this on does.
- Retry backoff beyond "the next 30-second cycle retries automatically" — deliberately
  simple for now (see `sink.ts`'s docstring for why); revisit if the wrapper API turns
  out to need more sophisticated backoff under load.
- None of this has been tested against a real MongoDB instance or a real wrapper API —
  only against 50 passing unit tests with mocked `fetch` and an in-memory sql.js DB.
