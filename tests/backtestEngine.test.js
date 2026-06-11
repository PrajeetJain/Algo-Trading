import { ok, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import { replayBacktest } from "../server/backtestEngine.js";
import { defaultEngineConfig } from "../server/botEngine.js";

// Synthetic in-memory candle store: one trending stock plus a calm NIFTY.
// 75 five-minute candles per day, 09:15-15:30 IST.

function dayCandles(day, startPrice, perCandleDriftPct) {
  const candles = [];
  let price = startPrice;
  for (let index = 0; index < 75; index += 1) {
    const totalMinutes = 9 * 60 + 15 + index * 5;
    const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minute = String(totalMinutes % 60).padStart(2, "0");
    const open = price;
    const close = price * (1 + perCandleDriftPct / 100);
    candles.push({
      time: `${day}T${hour}:${minute}:00+05:30`,
      open,
      high: Math.max(open, close) * 1.0005,
      low: Math.min(open, close) * 0.9995,
      close,
      volume: 50000,
    });
    price = close;
  }
  return candles;
}

function makeStore() {
  const days = ["2026-06-08", "2026-06-09", "2026-06-10"];
  const bySymbol = new Map();
  let reliancePrice = 1000;
  let niftyPrice = 23000;
  const reliance = [];
  const nifty = [];
  for (const day of days) {
    reliance.push(...dayCandles(day, reliancePrice, 0.06));
    nifty.push(...dayCandles(day, niftyPrice, 0.01));
    reliancePrice *= 1.046;
    niftyPrice *= 1.0075;
  }
  bySymbol.set("RELIANCE", reliance);
  bySymbol.set("NIFTY 50", nifty);
  return {
    storedDays() {
      return days;
    },
    candlesForDays(symbol, _interval, wantedDays) {
      const candles = bySymbol.get(symbol) ?? [];
      const wanted = new Set(wantedDays);
      return candles.filter((candle) => wanted.has(candle.time.slice(0, 10)));
    },
  };
}

const permissiveConfig = {
  ...defaultEngineConfig,
  minScore: 1,
  minMomentumPct: 0,
  minRelativeStrengthPct: -100,
  minNetRewardRisk: -5,
};

test("replay throws without stored candles", () => {
  throws(
    () => replayBacktest({ config: permissiveConfig, store: { storedDays: () => [], candlesForDays: () => [] } }),
    /No stored candles/
  );
});

test("replay takes trades on a trending stock and produces a full report", () => {
  const result = replayBacktest({ config: permissiveConfig, store: makeStore() });
  strictEqual(result.days, 3);
  ok(result.trades >= 1, `expected trades, got ${result.trades}`);
  ok(Number.isFinite(result.netPnl));
  ok(result.sampleTrades.length >= 1);
  const trade = result.sampleTrades[0];
  strictEqual(trade.symbol, "RELIANCE");
  ok(["stop-loss", "target", "daily-target", "daily-loss", "square-off", "eod-close"].includes(trade.exitReason));
  ok(result.totalCharges > 0, "charges must be deducted");
  ok(Array.isArray(result.daily) && result.daily.length === 3);
});

test("replay honors max trades per day", () => {
  const result = replayBacktest({ config: { ...permissiveConfig, maxTrades: 1 }, store: makeStore() });
  for (const day of result.daily) {
    ok(day.trades <= 1, `day ${day.day} took ${day.trades} trades`);
  }
});

test("replay respects requested day subset", () => {
  const result = replayBacktest({ config: permissiveConfig, days: ["2026-06-09"], store: makeStore() });
  strictEqual(result.days, 1);
  strictEqual(result.daily[0].day, "2026-06-09");
});

test("strict gates produce fewer or zero trades than permissive gates", () => {
  const permissive = replayBacktest({ config: permissiveConfig, store: makeStore() });
  const strict = replayBacktest({ config: { ...defaultEngineConfig, minScore: 99 }, store: makeStore() });
  ok(strict.trades <= permissive.trades);
});
