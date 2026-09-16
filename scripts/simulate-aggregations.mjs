#!/usr/bin/env node
// Computes the same results as scripts/mongo-aggregations.js's pipelines, in plain JS,
// against seed/sample-events.json. This is NOT a MongoDB stand-in for production use —
// it exists purely so we can see real numbers from the pipelines above without needing
// a running MongoDB server in this environment. Run: node scripts/simulate-aggregations.mjs

import { readFileSync } from 'node:fs';

const events = JSON.parse(readFileSync(new URL('../seed/sample-events.json', import.meta.url)));
const chats = events.filter((e) => e.kind === 'chat');
const toolCalls = events.filter((e) => e.kind === 'tool_call');

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

console.log('=== 1. costAndUsageByAgent ===');
console.table(
  [...groupBy(chats, (c) => c.agentName)]
    .map(([agentName, rows]) => ({
      agentName,
      chatRequests: rows.length,
      totalUsdCost: round(rows.reduce((s, r) => s + r.usdCost, 0), 4),
      totalPremiumUnits: round(rows.reduce((s, r) => s + r.premiumRequestUnits, 0), 1),
      totalInputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
      activeUserCount: new Set(rows.map((r) => r.userId)).size
    }))
    .sort((a, b) => b.totalUsdCost - a.totalUsdCost)
);

console.log('\n=== 2. modelMixByAgent ===');
for (const [agentName, rows] of groupBy(chats, (c) => c.agentName)) {
  console.log(`  ${agentName}:`);
  console.table(
    [...groupBy(rows, (r) => r.resolvedModel)]
      .map(([model, rs]) => ({
        model,
        requests: rs.length,
        totalUsdCost: round(rs.reduce((s, r) => s + r.usdCost, 0), 4),
        avgInputTokens: Math.round(rs.reduce((s, r) => s + r.inputTokens, 0) / rs.length)
      }))
      .sort((a, b) => b.totalUsdCost - a.totalUsdCost)
  );
}

console.log('=== 3. toolErrorRateByAgent ===');
console.table(
  [...groupBy(toolCalls, (t) => t.agentName)]
    .map(([agentName, rows]) => {
      const errors = rows.filter((r) => r.errorType != null).length;
      return { agentName, toolCalls: rows.length, toolErrors: errors, errorRatePct: round((errors / rows.length) * 100) };
    })
    .sort((a, b) => b.errorRatePct - a.errorRatePct)
);

console.log('\n=== 4. cacheEfficiencyByAgent (worst first) ===');
console.table(
  [...groupBy(chats.filter((c) => c.inputTokens > 0), (c) => c.agentName)]
    .map(([agentName, rows]) => {
      const totalInput = rows.reduce((s, r) => s + r.inputTokens, 0);
      const totalCached = rows.reduce((s, r) => s + r.cachedTokens, 0);
      return { agentName, totalInputTokens: totalInput, totalCachedTokens: totalCached, cacheHitRatioPct: round((totalCached / totalInput) * 100) };
    })
    .sort((a, b) => a.cacheHitRatioPct - b.cacheHitRatioPct)
);

console.log('\n=== 5. userAgentLeaderboard ===');
console.table(
  [...groupBy(chats, (c) => `${c.userId}::${c.agentName}`)]
    .map(([key, rows]) => {
      const [userId, agentName] = key.split('::');
      return { userId, agentName, requests: rows.length, totalUsdCost: round(rows.reduce((s, r) => s + r.usdCost, 0), 4) };
    })
    .sort((a, b) => (a.userId === b.userId ? b.totalUsdCost - a.totalUsdCost : a.userId.localeCompare(b.userId)))
);

console.log('\n=== 6. dailyCostByAgent ===');
console.table(
  [...groupBy(chats, (c) => `${new Date(c.timestampMs).toISOString().slice(0, 10)}::${c.agentName}`)]
    .map(([key, rows]) => {
      const [day, agentName] = key.split('::');
      return { day, agentName, requests: rows.length, totalUsdCost: round(rows.reduce((s, r) => s + r.usdCost, 0), 4) };
    })
    .sort((a, b) => (a.day === b.day ? a.agentName.localeCompare(b.agentName) : a.day.localeCompare(b.day)))
);
