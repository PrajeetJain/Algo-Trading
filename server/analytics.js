import { readEvents } from "./database.js";
import { tradeHistory } from "./orders.js";
import { allDayStats, closedPositions } from "./positionsStore.js";

const MILESTONE_PCTS = [0.25, 0.5, 0.75, 1];

function pct(value, total) {
  return total ? (value / total) * 100 : 0;
}

function istHourLabel(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "??";
  return `${hour}:00`;
}

function bucketLabel(value, edges, format = (edge) => String(edge)) {
  for (let index = 0; index < edges.length; index += 1) {
    if (value < edges[index]) {
      return index === 0 ? `< ${format(edges[0])}` : `${format(edges[index - 1])}-${format(edges[index])}`;
    }
  }
  return `>= ${format(edges[edges.length - 1])}`;
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

// Joins each closed trade to the market regime logged nearest (at or before)
// its entry, so outcomes can be sliced by the regime the bot traded in.
function regimeAtEntry(trade, snapshots) {
  const entryTime = new Date(trade.entryAt).getTime();
  let best = null;
  for (const snapshot of snapshots) {
    const time = new Date(snapshot.createdAt).getTime();
    if (time <= entryTime && (!best || time > best.time)) {
      best = { time, label: snapshot.marketRegime?.label ?? snapshot.signals?.[0]?.marketRegime?.label ?? "unknown" };
    }
  }
  return best?.label ?? "unknown";
}

/**
 * Trade-quality payload built from the bot engine's durable positions:
 * MFE/MAE, time in trade, exit-reason distribution, R-multiples, capture
 * ratio, plus day-level peak/give-back and profit-milestone frequency.
 */
export function tradeQuality({ capital = 50000, limit = 200 } = {}) {
  const positions = closedPositions(limit);
  const trades = positions.map((position) => {
    const timeInTradeMin =
      position.exitAt && position.entryAt
        ? Math.max(0, (new Date(position.exitAt).getTime() - new Date(position.entryAt).getTime()) / 60000)
        : 0;
    const mfeAmount = (position.mfe ?? 0) * position.quantity;
    const maeAmount = (position.mae ?? 0) * position.quantity;
    const riskAmount = position.stopLoss
      ? Math.abs(position.entryPrice - position.stopLoss) * position.quantity
      : 0;
    return {
      id: position.id,
      tradeDate: position.tradeDate,
      symbol: position.symbol,
      side: position.side,
      strategy: position.strategy,
      quantity: position.quantity,
      entryAt: position.entryAt,
      exitAt: position.exitAt,
      timeInTradeMin,
      exitReason: position.exitReason ?? "unknown",
      netPnl: position.netPnl ?? 0,
      grossPnl: position.grossPnl ?? 0,
      charges: position.charges ?? 0,
      mfeAmount,
      maeAmount,
      rMultiple: riskAmount ? (position.netPnl ?? 0) / riskAmount : 0,
      captureRatio: mfeAmount > 0 ? (position.netPnl ?? 0) / mfeAmount : 0,
    };
  });

  const closed = trades.length;
  const sum = (selector) => trades.reduce((total, trade) => total + selector(trade), 0);
  const exitReasons = new Map();
  for (const trade of trades) {
    const bucket = exitReasons.get(trade.exitReason) ?? { reason: trade.exitReason, trades: 0, netPnl: 0 };
    bucket.trades += 1;
    bucket.netPnl += trade.netPnl;
    exitReasons.set(trade.exitReason, bucket);
  }

  const dayStats = allDayStats();
  const milestoneFrequency = MILESTONE_PCTS.map((milestonePct) => {
    const amount = (capital * milestonePct) / 100;
    const daysHit = dayStats.filter((day) => day.peakPnl >= amount).length;
    const daysHeld = dayStats.filter((day) => day.peakPnl >= amount && day.lastPnl >= amount).length;
    return {
      pct: milestonePct,
      amount,
      daysHit,
      daysHeld,
      hitRate: pct(daysHit, dayStats.length),
      holdRate: pct(daysHeld, daysHit),
    };
  });

  const totalGross = sum((trade) => Math.abs(trade.grossPnl));
  return {
    generatedAt: new Date().toISOString(),
    capital,
    totals: {
      closedTrades: closed,
      netPnl: sum((trade) => trade.netPnl),
      avgTimeInTradeMin: closed ? sum((trade) => trade.timeInTradeMin) / closed : 0,
      avgMfeAmount: closed ? sum((trade) => trade.mfeAmount) / closed : 0,
      avgMaeAmount: closed ? sum((trade) => trade.maeAmount) / closed : 0,
      avgRMultiple: closed ? sum((trade) => trade.rMultiple) / closed : 0,
      avgCaptureRatio: closed ? sum((trade) => trade.captureRatio) / closed : 0,
      chargesPctOfGross: totalGross ? (sum((trade) => trade.charges) / totalGross) * 100 : 0,
    },
    exitReasons: [...exitReasons.values()].sort((a, b) => b.trades - a.trades),
    milestoneFrequency,
    dayStats: dayStats.slice(0, 30).map((day) => ({
      ...day,
      gaveBack: Math.max(0, day.peakPnl - day.lastPnl),
    })),
    trades: trades.slice(0, 50),
  };
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
      byHour: groupTrades(closedTrades, (trade) => istHourLabel(trade.entryAt)),
      byEntryRegime: groupTrades(closedTrades, (trade) => regimeAtEntry(trade, snapshots)),
    },
    signalQuality: {
      byStrategy: groupSignals(snapshots, (signal) => signal.strategy),
      bySymbol: groupSignals(snapshots, (signal) => signal.symbol),
      bySide: groupSignals(snapshots, (signal) => signal.side),
      byRegime: summarizeRegimes(snapshots),
      byScoreBucket: groupSignals(snapshots, (signal) => bucketLabel(Number(signal.score ?? 0), [60, 70, 80, 90])),
      bySpreadBucket: groupSignals(snapshots, (signal) =>
        bucketLabel(Number(signal.spreadBps ?? 999), [6, 12, 18, 24], (edge) => `${edge}bps`)
      ),
      byRelativeStrengthBucket: groupSignals(snapshots, (signal) =>
        bucketLabel(Number(signal.relativeStrengthPct ?? 0), [-0.5, 0, 0.25, 0.75], (edge) => `${edge}%`)
      ),
      recent: topRecentSignals(snapshots),
    },
  };
}
