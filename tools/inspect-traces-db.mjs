#!/usr/bin/env node
// Local smoke test against your REAL agent-traces.db, using the actual production
// ingestion/storage code (not a reimplementation) — see README.md "Testing this
// yourself". Requires `npm run build` first (imports from dist/, not src/).
//
// Prints ONLY aggregates: model names, agent names, counts, token totals, cost
// estimates. Never touches or prints prompt/response content, file paths beyond the DB
// location itself, or anything else identifying. Safe to share the printed output back
// if something looks wrong — there is nothing in it that wasn't already an aggregate
// number or a model/agent name.
//
// Usage:
//   npm run build
//   node tools/inspect-traces-db.mjs [--path /custom/path/to/agent-traces.db]

import { existsSync } from 'node:fs';
import { findExistingTracesDbPath, candidateTracesDbPaths } from '../dist/ingest/vscodePaths.js';
import { readTraceSpansFromFile } from '../dist/ingest/tracesDb.js';
import { UsageDb } from '../dist/storage/db.js';

const args = process.argv.slice(2);
const pathIdx = args.indexOf('--path');
const explicitPath = pathIdx !== -1 ? args[pathIdx + 1] : undefined;

async function main() {
  const dbPath = explicitPath ?? findExistingTracesDbPath();

  if (!dbPath || !existsSync(dbPath)) {
    console.log('No agent-traces.db found at any of these candidate locations:');
    for (const p of candidateTracesDbPaths()) console.log(`  ${p}`);
    console.log('\nIf your Copilot Chat data lives somewhere else, pass --path explicitly.');
    process.exitCode = 1;
    return;
  }

  console.log(`Reading: ${dbPath}\n`);

  const { results, excludedAggregateRollups } = await readTraceSpansFromFile(dbPath);

  const warnings = results.filter((r) => r.warning != null);
  const events = results.filter((r) => r.event != null).map((r) => r.event);

  console.log(`Rows read: ${results.length}`);
  console.log(`Excluded "GitHub Copilot Chat" rollup rows (correctly, to avoid double-counting): ${excludedAggregateRollups}`);
  console.log(`Rows that failed to normalize (see warnings below): ${warnings.length}`);
  console.log(`Usable events: ${events.length}\n`);

  if (warnings.length > 0) {
    console.log('--- Warnings (first 10) ---');
    for (const w of warnings.slice(0, 10)) console.log(`  ${w.warning}`);
    console.log();
  }

  const db = await UsageDb.create();
  for (const event of events) {
    if (event.kind === 'chat') db.insertChatEvent(event);
    else db.insertToolCallEvent(event);
  }

  console.log('--- By model ---');
  console.table(
    db.aggregateByModel().map((m) => ({
      model: m.model,
      requests: m.requestCount,
      inputTokens: m.totalInputTokens,
      outputTokens: m.totalOutputTokens,
      cachedTokens: m.totalCachedTokens,
      usdCost: m.totalUsdCost > 0 ? `$${m.totalUsdCost.toFixed(4)}` : '—',
      premiumUnits: m.totalPremiumRequestUnits
    }))
  );

  console.log('\n--- By agent/surface ---');
  console.table(db.aggregateByAgent());

  db.close();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exitCode = 1;
});
