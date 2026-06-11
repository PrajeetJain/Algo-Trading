import { readEvents } from "./database.js";
import { tradeHistory } from "./orders.js";

function pct(value, total) {
  return total ? (value / total) * 100 : 0;
}

function average(total, count) {
  return count ? total / count : 0;
}

function createTradeBucket(key) {
  return {
    key,
    trades: 0,
    wins: 0,
    losses: 0,
    grossPnl: 0,
    charges: 0,
    netPnl: 0,
    avgWin: 0,
    avgLoss: 0,
    winRate: 0,
    profitFactor: 0,
  };
}

function addTrade(bucket, trade) {
  bucket.trades += 1;
  bucket.wins += trade.netPnl > 0 ? 1 : 0;
  bucket.losses += trade.netPnl < 0 ? 1 : 0;
  bucket.grossPnl += trade.grossPnl;
  bucket.charges += trade.charges;
  bucket.netPnl += trade.netPnl;
  bucket.totalWin = (bucket.totalWin ?? 0) + (trade.netPnl > 0 ? trade.netPnl : 0);
  bucket.totalLoss = (bucket.totalLoss ?? 0) + (trade.netPnl < 0 ? Math.abs(trade.netPnl) : 0);
}

function finalizeTradeBucket(bucket) {
  const totalLoss = bucket.totalLoss ?? 0;
  const totalWin = bucket.totalWin ?? 0;
  return {
    key: bucket.key,
    trades: bucket.trades,
    wins: bucket.wins,
    losses: bucket.losses,
    grossPnl: bucket.grossPnl,
    charges: bucket.charges,
    netPnl: bucket.netPnl,
    avgWin: average(totalWin, bucket.wins),
    avgLoss: average(totalLoss, bucket.losses),
    winRate: pct(bucket.wins, bucket.trades),
    profitFactor: totalLoss ? totalWin / totalLoss : totalWin ? 99 : 0,
  };
}

function groupTrades(trades, keyFor) {
  const groups = new Map();
  for (const trade of trades.filter((item) => item.status === "CLOSED")) {
    const key = keyFor(trade) || "unknown";
    const bucket = groups.get(key) ?? createTradeBucket(key);
    addTrade(bucket, trade);
    groups.set(key, bucket);
  }
  return [...groups.values()]
    .map(finalizeTradeBucket)
    .sort((a, b) => b.trades - a.trades || b.netPnl - a.netPnl);
}

function createSignalBucket(key) {
  return {
    key,
    samples: 0,
    eligible: 0,
    tradeDecisions: 0,
    avgScore: 0,
    avgRelativeStrength: 0,
    avgNetRewardRisk: 0,
  };
}

function addSignal(bucket, signal, tradeDecision = false) {
  bucket.samples += 1;
  bucket.eligible += signal.eligible ? 1 : 0;
  bucket.tradeDecisions += tradeDecision ? 1 : 0;
  bucket.scoreTotal = (bucket.scoreTotal ?? 0) + Number(signal.score ?? 0);
  bucket.relativeStrengthTotal = (bucket.relativeStrengthTotal ?? 0) + Number(signal.relativeStrengthPct ?? 0);
  bucket.netRewardRiskTotal = (bucket.netRewardRiskTotal ?? 0) + Number(signal.netRewardRisk ?? 0);
}

function finalizeSignalBucket(bucket) {
  return {
    key: bucket.key,
    samples: bucket.samples,
    eligible: bucket.eligible,
    tradeDecisions: bucket.tradeDecisions,
    eligibleRate: pct(bucket.eligible, bucket.samples),
    avgScore: average(bucket.scoreTotal ?? 0, bucket.samples),
    avgRelativeStrength: average(bucket.relativeStrengthTotal ?? 0, bucket.samples),
    avgNetRewardRisk: average(bucket.netRewardRiskTotal ?? 0, bucket.samples),
  };
}

function groupSignals(snapshots, keyFor) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    for (const signal of snapshot.signals ?? []) {
      const key = keyFor(signal, snapshot) || "unknown";
      const bucket = groups.get(key) ?? createSignalBucket(key);
      addSignal(bucket, signal, snapshot.decision?.action === "TRADE" && snapshot.decision?.symbol === signal.symbol);
      groups.set(key, bucket);
    }
  }
  return [...groups.values()]
    .map(finalizeSignalBucket)
    .sort((a, b) => b.tradeDecisions - a.tradeDecisions || b.eligible - a.eligible || b.avgScore - a.avgScore);
}

function signalSnapshots(limit) {
  return readEvents(limit, "signals.snapshot")
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      ...(event.payload ?? {}),
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function topRecentSignals(snapshots, limit = 20) {
  const rows = [];
  for (const snapshot of snapshots) {
    for (const signal of snapshot.signals ?? []) {
      rows.push({
        id: `${snapshot.id}-${signal.symbol}`,
        createdAt: snapshot.createdAt,
        symbol: signal.symbol,
        side: signal.side,
        strategy: signal.strategy,
        score: signal.score,
        eligible: signal.eligible,
        relativeStrengthPct: signal.relativeStrengthPct ?? 0,
        netRewardRisk: signal.netRewardRisk ?? 0,
        regime: signal.marketRegime?.label ?? snapshot.marketRegime?.label ?? "unknown",
        gateReasons: signal.gateReasons ?? [],
      });
    }
  }
  return rows
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.score - a.score)
    .slice(0, limit);
}

function summarizeRegimes(snapshots) {
  const regimes = new Map();
  for (const snapshot of snapshots) {
    const key = snapshot.marketRegime?.label ?? snapshot.signals?.[0]?.marketRegime?.label ?? "unknown";
    const bucket = regimes.get(key) ?? {
      key,
      snapshots: 0,
      tradeDecisions: 0,
      eligibleSignals: 0,
      totalSignals: 0,
    };
    bucket.snapshots += 1;
    bucket.tradeDecisions += snapshot.decision?.action === "TRADE" ? 1 : 0;
    bucket.eligibleSignals += (snapshot.signals ?? []).filter((signal) => signal.eligible).length;
    bucket.totalSignals += snapshot.signals?.length ?? 0;
    regimes.set(key, bucket);
  }
  return [...regimes.values()]
    .map((item) => ({
      ...item,
      eligibleRate: pct(item.eligibleSignals, item.totalSignals),
    }))
    .sort((a, b) => b.snapshots - a.snapshots);
}

export function performanceAnalytics({ capital = 50000, limit = 50000 } = {}) {
  const history = tradeHistory({ capital, limit });
  const closedTrades = history.trades.filter((trade) => trade.status === "CLOSED");
  const snapshots = signalSnapshots(limit);
  const totalSignals = snapshots.reduce((total, snapshot) => total + (snapshot.signals?.length ?? 0), 0);
  const eligibleSignals = snapshots.reduce(
    (total, snapshot) => total + (snapshot.signals ?? []).filter((signal) => signal.eligible).length,
    0
  );
  const tradeDecisions = snapshots.filter((snapshot) => snapshot.decision?.action === "TRADE").length;

  return {
    generatedAt: new Date().toISOString(),
    capital,
    totals: {
      closedTrades: closedTrades.length,
      netPnl: history.totals.netPnl,
      winRate: history.totals.winRate,
      charges: history.totals.charges,
      signalSnapshots: snapshots.length,
      totalSignals,
      eligibleSignals,
      eligibleRate: pct(eligibleSignals, totalSignals),
      tradeDecisions,
      waitDecisions: Math.max(0, snapshots.length - tradeDecisions),
    },
    tradePerformance: {
      byStrategy: groupTrades(closedTrades, (trade) => trade.strategy),
      bySymbol: groupTrades(closedTrades, (trade) => trade.symbol),
      bySide: groupTrades(closedTrades, (trade) => trade.side),
    },
    signalQuality: {
      byStrategy: groupSignals(snapshots, (signal) => signal.strategy),
      bySymbol: groupSignals(snapshots, (signal) => signal.symbol),
      bySide: groupSignals(snapshots, (signal) => signal.side),
      byRegime: summarizeRegimes(snapshots),
      recent: topRecentSignals(snapshots),
    },
  };
}
