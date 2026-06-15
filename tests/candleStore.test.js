import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { resampleCandles } from "../server/candleStore.js";

function c(time, open, high, low, close, volume) {
  return { time, open, high, low, close, volume };
}

test("resampleCandles factor 1 is identity", () => {
  const candles = [c("2026-06-12T09:15:00+05:30", 100, 101, 99, 100.5, 10)];
  strictEqual(resampleCandles(candles, 1), candles);
});

test("resampleCandles 5m -> 15m aggregates OHLCV correctly", () => {
  const candles = [
    c("2026-06-12T09:15:00+05:30", 100, 102, 99, 101, 10),
    c("2026-06-12T09:20:00+05:30", 101, 105, 100, 104, 20),
    c("2026-06-12T09:25:00+05:30", 104, 106, 103, 105, 30),
  ];
  const out = resampleCandles(candles, 3);
  strictEqual(out.length, 1);
  deepStrictEqual(out[0], {
    time: "2026-06-12T09:15:00+05:30",
    open: 100, // first open
    high: 106, // max high
    low: 99, // min low
    close: 105, // last close
    volume: 60, // sum
  });
});

test("resampleCandles never merges across day boundaries", () => {
  const candles = [
    c("2026-06-12T15:25:00+05:30", 100, 101, 99, 100, 5),
    c("2026-06-15T09:15:00+05:30", 200, 201, 199, 200, 5),
    c("2026-06-15T09:20:00+05:30", 200, 202, 198, 201, 5),
  ];
  const out = resampleCandles(candles, 3);
  // Day 1 has only 1 candle -> its own bar; day 2's two candles -> one bar.
  strictEqual(out.length, 2);
  strictEqual(out[0].time.slice(0, 10), "2026-06-12");
  strictEqual(out[1].time.slice(0, 10), "2026-06-15");
  strictEqual(out[1].high, 202);
  strictEqual(out[1].low, 198);
});
