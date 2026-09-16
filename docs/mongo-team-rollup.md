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

## Open decisions (need your answer before building the exporter)

### 1. Identity model

Copilot's own telemetry carries no identity at all (confirmed earlier in `PLAN.md`'s
security posture section) — any `userId` in this schema has to come from *our*
extension, which means it's a real consent decision, not a technical one:

| Option | What it enables | Cost |
|---|---|---|
| **A. Fully anonymous** — random `installationId` only, no `userId` field at all | "20 machines used `Plan` N times" | Can't build query 5 (the leaderboard) at all |
| **B. Pseudonymous** — a stable hash of something the person already has (git `user.email`, OS username) | Query 5 works; trends per-person over time work; not reversible to a name without a side table your org keeps separately | Someone has to decide whether "not reversible without extra effort" is enough privacy, or whether it's security theater |
| **C. Real identity** — actual email/SSO identity, sent in clear | Full accountability, a real leaderboard with names | Ties usage timing/model/agent patterns to a named person — needs explicit notice, not just a technical default |

I'd default to **B** as the reasonable middle ground for an internal team tool, with C as
an opt-in per-person toggle for teams that explicitly want named leaderboards — but this
is an org-norms call, not mine to make silently.

### 2. Send frequency and the wrapper API's shape

The extension already has a working 30-second poll loop with a `sinceMs` watermark
(`refresh()` in `src/extension.ts`) that ingests new local events incrementally. The
natural, lowest-risk design reuses that exact mechanism rather than inventing a second
one:

- Track a **separate** `lastExportedMs` watermark from the existing `lastIngestedMs` one
  — export failure (API down, network blip) must never block local ingestion, and local
  ingestion must never be gated on export succeeding.
- On each existing 30-second cycle, POST whatever was newly ingested locally in that
  cycle (already computed, already has cost fields) to your wrapper API, capped at some
  batch size (e.g. 200 docs/call — chunk larger backlogs, e.g. after being offline).
  Cap policy is fine to tune once you know real event volume; not committing to 200 here.
- On failure: leave `lastExportedMs` where it was, back off (exponential, capped), retry
  next cycle. Nothing is lost — the local SQLite store already has everything.
- A manual "Sync Now" command, mirroring the existing "Refresh Now" command.

What I need from you to build the actual client: the wrapper API's contract — endpoint
URL, auth (a static token per install? per-org?), and whether it wants one document per
call or accepts a batch array in one POST body (batch is strongly preferable — 200
individual requests every 30 seconds across a team does not scale).

## What's NOT built yet

Everything above is schema + seed data + query design, run against synthetic data. Not
built: the actual export code path in `extension.ts`, the wrapper API itself (yours to
build — happy to help once its contract is decided), or any consent/opt-in UI for
whichever identity option gets picked. All of that is real Phase 4 execution, blocked on
the two decisions above.
