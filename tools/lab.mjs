// Strategy lab runner: executes a replay or walk-forward against the candle
// store in the CURRENT working directory's .aindra-data. Run it from an
// isolated sandbox copy so experiments never touch the live ledger:
//   node tools/lab.mjs '{"mode":"replay","config":{"stopLossPct":0.5}}'
import { replayBacktest, walkForward } from "../server/backtestEngine.js";

// Accepts plain JSON or base64 ("b64:<...>") — PowerShell 5.1 strips quotes
// from native-command arguments, so base64 is the reliable path on Windows.
const rawArg = process.argv[2] ?? "{}";
const args = JSON.parse(rawArg.startsWith("b64:") ? Buffer.from(rawArg.slice(4), "base64").toString("utf8") : rawArg);

const baseConfig = {
  capital: 200000,
  targetPct: 1,
  maxLossPct: 1,
  maxTrades: 3,
  slippageBps: 8,
  minScore: 70,
  minMomentumPct: 0.1,
  maxSpreadBps: 18,
  riskPerTradePct: 0.25,
  stopLossPct: 0.8,
  takeProfitPct: 1.6,
  atrStopMultiplier: 1.5,
  minRelativeStrengthPct: 0.05,
  minNetRewardRisk: 1.2,
  maxVix: 28,
  maxGapPct: 3,
  strategyMode: "hybrid",
  ...(args.config ?? {}),
};

if (args.mode === "walkforward") {
  const report = walkForward({
    baseConfig,
    gridSpec: args.gridSpec ?? undefined,
    trainDays: args.trainDays ?? 10,
    testDays: args.testDays ?? 5,
  });
  console.log(
    JSON.stringify({
      label: args.label ?? "walkforward",
      oos: report.outOfSample,
      inSampleDailyAvg: report.inSample.dailyAvgPnl,
      overfitWarning: report.overfitWarning,
      folds: report.folds.map((fold) => ({
        test: { from: fold.test.from, netPnl: Math.round(fold.test.netPnl), trades: fold.test.trades, winRate: fold.test.winRate },
        params: fold.chosenParams,
      })),
    })
  );
} else {
  const report = replayBacktest({ config: baseConfig });
  console.log(
    JSON.stringify({
      label: args.label ?? "replay",
      netPnl: Math.round(report.netPnl),
      trades: report.trades,
      winRate: report.winRate,
      profitFactor: Number(report.profitFactor.toFixed(2)),
      expectancy: Math.round(report.expectancy),
      maxDrawdown: Math.round(report.maxDrawdown),
      byStrategy: report.byStrategy.map((row) => ({ key: row.key, trades: row.trades, wins: row.wins, net: Math.round(row.netPnl) })),
      byExitReason: report.byExitReason.map((row) => ({ key: row.key, trades: row.trades, net: Math.round(row.netPnl) })),
    })
  );
}
