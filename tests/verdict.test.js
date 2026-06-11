import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { computeEvidence, tStatistic } from "../server/verdict.js";

function trade(netPnl, date = "2026-06-11") {
  return {
    status: "CLOSED",
    netPnl,
    grossPnl: netPnl + 20,
    charges: 20,
    date,
  };
}

function makeDays(dailyPnls) {
  return dailyPnls.map((netPnl, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    netPnl,
  }));
}

test("t-statistic flags small samples as not significant", () => {
  const result = tStatistic([50, 60, 40, 70, 30]);
  ok(result.t > 0);
  strictEqual(result.significant, false, "n=5 must never be significant");
});

test("t-statistic recognizes a consistent edge with n >= 30", () => {
  const values = Array.from({ length: 40 }, (_, index) => 80 + (index % 7) * 10);
  const result = tStatistic(values);
  ok(result.t > 2);
  strictEqual(result.significant, true);
});

test("insufficient data yields NOT-YET", () => {
  const report = computeEvidence({
    trades: [trade(100), trade(-50)],
    daily: makeDays([50]),
    dayStats: [],
    walkForward: null,
    capital: 50000,
  });
  strictEqual(report.verdict, "NOT-YET");
  ok(report.failedCriteria.includes("days"));
  ok(report.failedCriteria.includes("trades"));
});

test("sufficient data with poor performance yields NO-GO", () => {
  // 22 losing days, 40 trades averaging a loss.
  const trades = Array.from({ length: 40 }, (_, index) => trade(index % 3 === 0 ? 60 : -80));
  const report = computeEvidence({
    trades,
    daily: makeDays(Array.from({ length: 22 }, () => -90)),
    dayStats: [],
    walkForward: null,
    capital: 50000,
  });
  strictEqual(report.verdict, "NO-GO");
  ok(report.metrics.netPnl < 0);
  ok(report.failedCriteria.includes("net"));
});

test("strong consistent evidence yields GO", () => {
  // 25 days, 45 trades, steady positive expectancy well above 0.1% of capital.
  const trades = Array.from({ length: 45 }, (_, index) => trade(index % 5 === 4 ? -60 : 110));
  const report = computeEvidence({
    trades,
    daily: makeDays(Array.from({ length: 25 }, (_, index) => 150 + (index % 4) * 20)),
    dayStats: [],
    walkForward: { outOfSample: { netPnl: 900 }, overfitWarning: false },
    capital: 50000,
  });
  strictEqual(report.verdict, "GO", `failed: ${report.failedCriteria.join(", ")}`);
  ok(report.metrics.profitFactor >= 1.3);
  ok(report.metrics.tStatistic >= 2);
  strictEqual(report.failedCriteria.length, 0);
});

test("walk-forward overfit warning blocks GO", () => {
  const trades = Array.from({ length: 45 }, (_, index) => trade(index % 5 === 4 ? -60 : 110));
  const report = computeEvidence({
    trades,
    daily: makeDays(Array.from({ length: 25 }, () => 160)),
    dayStats: [],
    walkForward: { outOfSample: { netPnl: 900 }, overfitWarning: true },
    capital: 50000,
  });
  strictEqual(report.verdict, "NO-GO");
  ok(report.failedCriteria.includes("walkforward"));
});

test("drawdown beyond 5% of capital blocks GO", () => {
  const trades = Array.from({ length: 45 }, (_, index) => trade(index % 5 === 4 ? -60 : 110));
  // A brutal mid-month losing streak: cumulative trough > 5% of 50k.
  const daily = makeDays([300, 300, 300, -1500, -1400, -1200, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300]);
  const report = computeEvidence({
    trades,
    daily,
    dayStats: [],
    walkForward: { outOfSample: { netPnl: 900 }, overfitWarning: false },
    capital: 50000,
  });
  ok(report.failedCriteria.includes("drawdown"), `failed: ${report.failedCriteria.join(", ")}`);
});
