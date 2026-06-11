import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { sessionCandles, sizePosition } from "../server/strategy.js";

function candle(time, close = 100) {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 1000 };
}

test("sessionCandles keeps only today's IST candles", () => {
  const now = new Date("2026-06-11T11:00:00+05:30");
  const candles = [
    candle("2026-06-09T14:30:00+05:30"),
    candle("2026-06-10T09:15:00+05:30"),
    candle("2026-06-10T15:25:00+05:30"),
    candle("2026-06-11T09:15:00+05:30"),
    candle("2026-06-11T10:55:00+05:30"),
  ];
  const result = sessionCandles(candles, now);
  deepStrictEqual(
    result.map((item) => item.time),
    ["2026-06-11T09:15:00+05:30", "2026-06-11T10:55:00+05:30"]
  );
});

test("sessionCandles handles Kite's +0530 offset format", () => {
  const now = new Date("2026-06-11T11:00:00+05:30");
  const candles = [candle("2026-06-10T09:15:00+0530"), candle("2026-06-11T09:15:00+0530")];
  const result = sessionCandles(candles, now);
  strictEqual(result.length, 1);
  strictEqual(result[0].time, "2026-06-11T09:15:00+0530");
});

test("sessionCandles returns empty for empty input", () => {
  deepStrictEqual(sessionCandles([], new Date()), []);
});

test("sizePosition caps quantity by capital and risk", () => {
  const config = {
    capital: 50000,
    riskPerTradePct: 0.25,
    stopLossPct: 0.8,
    takeProfitPct: 1.6,
    atrStopMultiplier: 1.5,
  };
  const sizing = sizePosition({ price: 1000, atrValue: 0, config, side: "BUY" });
  // riskAmount 125, stopDistance max(8, 0, 4) = 8 -> riskQuantity 15
  strictEqual(sizing.quantity, 15);
  strictEqual(sizing.stopLossPrice, 992);
  ok(sizing.targetPrice >= 1011.2);
  const shortSizing = sizePosition({ price: 1000, atrValue: 0, config, side: "SELL" });
  strictEqual(shortSizing.stopLossPrice, 1008);
  ok(shortSizing.targetPrice <= 988.8);
});
