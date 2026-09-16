// Real MongoDB aggregation pipelines against the `copilot_usage_events` collection
// shape documented in docs/mongo-team-rollup.md and seeded in seed/sample-events.json.
//
// Run any of these in mongosh:
//   mongosh "<connection string>" --eval "load('scripts/mongo-aggregations.js')"
//   db.copilot_usage_events.aggregate(costAndUsageByAgent)
//
// Or via the Node driver: db.collection('copilot_usage_events').aggregate(costAndUsageByAgent).toArray()

// 1. Which custom agent/surface is actually costing the most?
const costAndUsageByAgent = [
  { $match: { kind: 'chat' } },
  {
    $group: {
      _id: '$agentName',
      chatRequests: { $sum: 1 },
      totalUsdCost: { $sum: '$usdCost' },
      totalPremiumUnits: { $sum: '$premiumRequestUnits' },
      totalInputTokens: { $sum: '$inputTokens' },
      totalOutputTokens: { $sum: '$outputTokens' },
      totalCachedTokens: { $sum: '$cachedTokens' },
      distinctUsers: { $addToSet: '$userId' }
    }
  },
  { $addFields: { activeUserCount: { $size: '$distinctUsers' } } },
  { $project: { distinctUsers: 0 } },
  { $sort: { totalUsdCost: -1 } }
];

// 2. Is a given agent defaulting to an unnecessarily expensive model?
//    (model mix per agent, not just a single blended average)
const modelMixByAgent = [
  { $match: { kind: 'chat' } },
  {
    $group: {
      _id: { agentName: '$agentName', model: '$resolvedModel' },
      requests: { $sum: 1 },
      totalUsdCost: { $sum: '$usdCost' },
      avgInputTokens: { $avg: '$inputTokens' }
    }
  },
  { $sort: { '_id.agentName': 1, totalUsdCost: -1 } },
  {
    $group: {
      _id: '$_id.agentName',
      models: {
        $push: {
          model: '$_id.model',
          requests: '$requests',
          totalUsdCost: '$totalUsdCost',
          avgInputTokens: { $round: ['$avgInputTokens', 0] }
        }
      }
    }
  }
];

// 3. Which agent wastes the most round-trips (tool-call error rate)?
const toolErrorRateByAgent = [
  { $match: { kind: 'tool_call' } },
  {
    $group: {
      _id: '$agentName',
      toolCalls: { $sum: 1 },
      toolErrors: { $sum: { $cond: [{ $ne: ['$errorType', null] }, 1, 0] } }
    }
  },
  { $addFields: { errorRatePct: { $round: [{ $multiply: [{ $divide: ['$toolErrors', '$toolCalls'] }, 100] }, 1] } } },
  { $sort: { errorRatePct: -1 } }
];

// 4. Cache efficiency per agent — a low ratio flags an agent whose prompts don't
//    reuse context well (resending large unchanging context every turn).
const cacheEfficiencyByAgent = [
  { $match: { kind: 'chat', inputTokens: { $gt: 0 } } },
  {
    $group: {
      _id: '$agentName',
      totalInputTokens: { $sum: '$inputTokens' },
      totalCachedTokens: { $sum: '$cachedTokens' }
    }
  },
  { $addFields: { cacheHitRatioPct: { $round: [{ $multiply: [{ $divide: ['$totalCachedTokens', '$totalInputTokens'] }, 100] }, 1] } } },
  { $sort: { cacheHitRatioPct: 1 } } // worst first
];

// 5. Per-user, per-agent leaderboard — needs whatever identity model gets decided
//    (see docs/mongo-team-rollup.md "Identity" section before shipping this one).
const userAgentLeaderboard = [
  { $match: { kind: 'chat' } },
  {
    $group: {
      _id: { userId: '$userId', agentName: '$agentName' },
      requests: { $sum: 1 },
      totalUsdCost: { $sum: '$usdCost' }
    }
  },
  { $sort: { '_id.userId': 1, totalUsdCost: -1 } }
];

// 6. Trend over time (daily buckets) per agent — for "is this getting worse" charts.
const dailyCostByAgent = [
  { $match: { kind: 'chat' } },
  {
    $group: {
      _id: {
        agentName: '$agentName',
        day: { $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$timestampMs' } } }
      },
      totalUsdCost: { $sum: '$usdCost' },
      requests: { $sum: 1 }
    }
  },
  { $sort: { '_id.day': 1, '_id.agentName': 1 } }
];

if (typeof module !== 'undefined') {
  module.exports = {
    costAndUsageByAgent,
    modelMixByAgent,
    toolErrorRateByAgent,
    cacheEfficiencyByAgent,
    userAgentLeaderboard,
    dailyCostByAgent
  };
}
