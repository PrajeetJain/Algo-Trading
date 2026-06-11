import { tradeHistory } from "./ledger.js";
import { latestWalkForward } from "./backtestEngine.js";
import { allDayStats } from "./positionsStore.js";

// The evidence scorecard answers one question with explicit criteria:
// "Has this strategy earned the right to be discussed for real money?"
// All thresholds are deliberately conservative. A month of paper trading
// that fails here is a cheap lesson; real money that fails is not.

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function stdDev(values) {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - avg) ** 2, 0) / (values.length - 1));
}

/**
 * One-sample t-statistic against zero. With n >= ~30 the normal
 * approximation is reasonable; below that we report the t-stat but flag the
 * sample as too small to call.
 */
export function tStatistic(values) {
  const n = values.length;
  if (n < 2) {
    return { t: 0, n, significant: false };
  }
  const sd = stdDev(values);
  const t = sd ? (mean(values) / (sd / Math.sqrt(n))) : 0;
  return { t, n, significant: n >= 30 && t >= 2 };
}

export function computeEvidence({ trades, daily, dayStats, walkForward, capital }) {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const tradePnls = closed.map((trade) => trade.netPnl);
  const dailyPnls = daily.map((day) => day.netPnl);
  const tradingDays = daily.length;

  const netPnl = tradePnls.reduce((total, value) => total + value, 0);
  const charges = closed.reduce((total, trade) => total + trade.charges, 0);
  const grossAbs = closed.reduce((total, trade) => total + Math.abs(trade.grossPnl), 0);
  const wins = closed.filter((trade) => trade.netPnl > 0);
  const losses = closed.filter((trade) => trade.netPnl < 0);
  const totalWin = wins.reduce((total, trade) => total + trade.netPnl, 0);
  const totalLoss = Math.abs(losses.reduce((total, trade) => total + trade.netPnl, 0));
  const profitFactor = totalLoss ? totalWin / totalLoss : totalWin ? 99 : 0;
  const expectancy = closed.length ? netPnl / closed.length : 0;

  // Equity curve over days -> max drawdown.
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve = [];
  for (const day of [...daily].sort((a, b) => a.date.localeCompare(b.date))) {
    equity += day.netPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
    equityCurve.push({ date: day.date, equity });
  }

  let lossStreak = 0;
  let maxConsecutiveLosingTrades = 0;
  for (const trade of closed) {
    lossStreak = trade.netPnl < 0 ? lossStreak + 1 : 0;
    maxConsecutiveLosingTrades = Math.max(maxConsecutiveLosingTrades, lossStreak);
  }
  let dayLossStreak = 0;
  let maxConsecutiveLosingDays = 0;
  for (const day of [...daily].sort((a, b) => a.date.localeCompare(b.date))) {
    dayLossStreak = day.netPnl < 0 ? dayLossStreak + 1 : 0;
    maxConsecutiveLosingDays = Math.max(maxConsecutiveLosingDays, dayLossStreak);
  }

  const dailyMean = mean(dailyPnls);
  const dailySd = stdDev(dailyPnls);
  const sharpeDaily = dailySd ? dailyMean / dailySd : 0;
  const sharpeAnnualized = sharpeDaily * Math.sqrt(252);
  const tradeT = tStatistic(tradePnls);
  const giveBackTotal = dayStats.reduce((total, day) => total + Math.max(0, day.peakPnl - day.lastPnl), 0);

  const metrics = {
    tradingDays,
    closedTrades: closed.length,
    netPnl,
    charges,
    chargesPctOfGross: grossAbs ? (charges / grossAbs) * 100 : 0,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    expectancy,
    expectancyPctOfCapital: capital ? (expectancy / capital) * 100 : 0,
    profitFactor,
    avgWin: wins.length ? totalWin / wins.length : 0,
    avgLoss: losses.length ? totalLoss / losses.length : 0,
    maxDrawdown,
    maxDrawdownPctOfCapital: capital ? (Math.abs(maxDrawdown) / capital) * 100 : 0,
    maxConsecutiveLosingTrades,
    maxConsecutiveLosingDays,
    dailyAvgPnl: dailyMean,
    sharpeDaily,
    sharpeAnnualized,
    tStatistic: tradeT.t,
    avgGiveBackPerDay: dayStats.length ? giveBackTotal / dayStats.length : 0,
    walkForwardOosPnl: walkForward?.outOfSample?.netPnl ?? null,
    walkForwardOverfit: walkForward?.overfitWarning ?? null,
  };

  const criteria = [
    {
      id: "days",
      label: "At least 20 paper trading days",
      required: ">= 20 days",
      actual: `${tradingDays} days`,
      pass: tradingDays >= 20,
      gating: "data",
    },
    {
      id: "trades",
      label: "At least 30 closed trades",
      required: ">= 30 trades",
      actual: `${closed.length} trades`,
      pass: closed.length >= 30,
      gating: "data",
    },
    {
      id: "net",
      label: "Positive net P&L after all charges",
      required: "> 0",
      actual: netPnl.toFixed(2),
      pass: netPnl > 0,
      gating: "performance",
    },
    {
      id: "pf",
      label: "Profit factor",
      required: ">= 1.3",
      actual: profitFactor.toFixed(2),
      pass: profitFactor >= 1.3,
      gating: "performance",
    },
    {
      id: "expectancy",
      label: "Expectancy per trade",
      required: `>= 0.1% of capital (${(capital * 0.001).toFixed(0)})`,
      actual: expectancy.toFixed(2),
      pass: expectancy >= capital * 0.001,
      gating: "performance",
    },
    {
      id: "drawdown",
      label: "Max drawdown",
      required: "<= 5% of capital",
      actual: `${metrics.maxDrawdownPctOfCapital.toFixed(2)}%`,
      pass: metrics.maxDrawdownPctOfCapital <= 5,
      gating: "performance",
    },
    {
      id: "tstat",
      label: "Edge statistically distinguishable from zero",
      required: "t >= 2.0 with n >= 30",
      actual: `t = ${tradeT.t.toFixed(2)} (n = ${tradeT.n})`,
      pass: tradeT.significant,
      gating: "performance",
    },
    {
      id: "walkforward",
      label: "Walk-forward out-of-sample positive",
      required: "> 0, no overfit warning",
      actual:
        walkForward === null || walkForward === undefined
          ? "not run yet"
          : `${(walkForward.outOfSample?.netPnl ?? 0).toFixed(2)}${walkForward.overfitWarning ? " (overfit warning)" : ""}`,
      pass: Boolean(walkForward && (walkForward.outOfSample?.netPnl ?? 0) > 0 && !walkForward.overfitWarning),
      gating: "performance",
    },
  ];

  const dataCriteria = criteria.filter((item) => item.gating === "data");
  const performanceCriteria = criteria.filter((item) => item.gating === "performance");
  const dataSufficient = dataCriteria.every((item) => item.pass);
  const allPass = criteria.every((item) => item.pass);

  const verdict = allPass ? "GO" : dataSufficient ? "NO-GO" : "NOT-YET";
  const verdictText =
    verdict === "GO"
      ? "All criteria pass. The next step is still NOT live capital — it is a live dry-run and a tiny-capital test."
      : verdict === "NO-GO"
        ? "Evidence is sufficient and the strategy does NOT show a tradeable edge. Do not fund this. Iterate on strategy quality and re-test."
        : "Not enough evidence yet. Keep paper trading — judging a strategy on a handful of trades is how accounts get destroyed.";

  return {
    generatedAt: new Date().toISOString(),
    capital,
    verdict,
    verdictText,
    criteria,
    metrics,
    equityCurve,
    failedCriteria: criteria.filter((item) => !item.pass).map((item) => item.id),
    performanceFailures: performanceCriteria.filter((item) => !item.pass).length,
  };
}

export function evidenceReport({ capital = 50000 } = {}) {
  const history = tradeHistory({ capital });
  return computeEvidence({
    trades: history.trades,
    daily: history.daily,
    dayStats: allDayStats(),
    walkForward: latestWalkForward(),
    capital,
  });
}
