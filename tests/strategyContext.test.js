import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { applyTick, defaultEngineConfig } from "../server/botEngine.js";
import {
  computeMarketContext,
  computeSectorStrength,
  generateSignals,
  sizePosition,
  strategyProfile,
  volumePulse,
} from "../server/strategy.js";

function todayIst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function quote(symbol, sector, ltp, close, overrides = {}) {
  return {
    symbol,
    name: symbol,
    sector,
    source: "kite-rest",
    ltp,
    open: overrides.open ?? close,
    high: Math.max(ltp, close),
    low: Math.min(ltp, close),
    close,
    volume: 100000,
    spreadBps: 8,
    ...overrides,
  };
}

test("market context computes VIX, Bank Nifty bias, and breadth", () => {
  const context = computeMarketContext([
    quote("NIFTY 50", "Index", 23200, 23000),
    quote("NIFTY BANK", "Index", 49000, 49500),
    quote("INDIA VIX", "Index", 17.5, 16),
    quote("INFY", "IT Services", 1510, 1500),
    quote("TCS", "IT Services", 3950, 3900),
    quote("SBIN", "Banking", 790, 800),
  ]);
  ok(context.niftyBias > 0.8);
  ok(context.bankNiftyBias < 0);
  strictEqual(context.vix, 17.5);
  strictEqual(context.advancers, 2);
  strictEqual(context.decliners, 1);
  strictEqual(context.breadth, "positive");
});

test("sector strength ranks sectors by average momentum", () => {
  const ranks = computeSectorStrength([
    quote("INFY", "IT Services", 1530, 1500),
    quote("TCS", "IT Services", 3978, 3900),
    quote("SBIN", "Banking", 792, 800),
    quote("HDFCBANK", "Banking", 1630, 1640),
  ]);
  strictEqual(ranks[0].sector, "IT Services");
  strictEqual(ranks[0].rank, 1);
  strictEqual(ranks[1].sector, "Banking");
  ok(ranks[0].avgMomentumPct > 0);
  ok(ranks[1].avgMomentumPct < 0);
});

test("strategy profiles give mean reversion a closer target than momentum", () => {
  const config = { capital: 50000, riskPerTradePct: 0.25, stopLossPct: 0.8, takeProfitPct: 1.6, atrStopMultiplier: 1.5 };
  const momentum = sizePosition({ price: 1000, config, side: "BUY", strategyMode: "momentum" });
  const meanRev = sizePosition({ price: 1000, config, side: "BUY", strategyMode: "mean-reversion" });
  ok(meanRev.targetPrice < momentum.targetPrice, "mean reversion target should be closer");
  ok(strategyProfile("mean-reversion").trailAtR === 0, "mean reversion does not trail");
  ok(strategyProfile("momentum").trailAtR > 0, "momentum trails");
});

test("VIX above the gate blocks all entries", () => {
  const signals = generateSignals({
    quotes: [
      quote("NIFTY 50", "Index", 23200, 23000),
      quote("INDIA VIX", "Index", 35, 30),
      quote("INFY", "IT Services", 1530, 1500),
    ],
    candlesBySymbol: {},
    config: { ...defaultEngineConfig, minScore: 1, minMomentumPct: 0, minRelativeStrengthPct: -100, minNetRewardRisk: -5 },
  });
  const infy = signals.find((signal) => signal.symbol === "INFY");
  strictEqual(infy.eligible, false);
  ok(infy.gateReasons.some((reason) => reason.startsWith("VIX")), infy.gateReasons.join(", "));
});

test("gap-open blocks momentum chase entries in the first 45 minutes", () => {
  const signals = generateSignals({
    quotes: [
      quote("NIFTY 50", "Index", 23100, 23000),
      quote("INFY", "IT Services", 1580, 1500, { open: 1575 }),
    ],
    candlesBySymbol: {},
    config: {
      ...defaultEngineConfig,
      strategyMode: "momentum",
      minScore: 1,
      minMomentumPct: 0,
      minRelativeStrengthPct: -100,
      minNetRewardRisk: -5,
    },
    asOf: "2026-06-11T09:35:00+05:30",
  });
  const infy = signals.find((signal) => signal.symbol === "INFY");
  ok(infy.gateReasons.some((reason) => reason.startsWith("gap-open")), infy.gateReasons.join(", "));
  ok(Math.abs(infy.gapPct - 5) < 0.01, `gapPct ${infy.gapPct}`);
});

test("RS ranking assigns rank and percentile across the universe", () => {
  const signals = generateSignals({
    quotes: [
      quote("NIFTY 50", "Index", 23000, 23000),
      quote("INFY", "IT Services", 1530, 1500),
      quote("TCS", "IT Services", 3900, 3900),
      quote("SBIN", "Banking", 792, 800),
    ],
    candlesBySymbol: {},
    config: defaultEngineConfig,
  });
  const infy = signals.find((signal) => signal.symbol === "INFY");
  const sbin = signals.find((signal) => signal.symbol === "SBIN");
  strictEqual(infy.rsRank, 1);
  strictEqual(sbin.rsRank, 3);
  ok(infy.rsPercentile > sbin.rsPercentile);
});

test("volumePulse ignores the partial in-progress candle", () => {
  const baseline = Array.from({ length: 20 }, (_, index) => ({ volume: 10000, time: `c${index}` }));
  // Spike on the last closed candle, tiny partial volume on the forming one.
  const spikeThenPartial = [...baseline, { volume: 40000 }, { volume: 500 }];
  ok(volumePulse(spikeThenPartial) >= 3.9, "spike on closed candle must register despite tiny forming candle");
  // No spike anywhere: pulse near 1.
  const flat = [...baseline, { volume: 10000 }, { volume: 10000 }];
  ok(Math.abs(volumePulse(flat) - 1) < 0.05);
  strictEqual(volumePulse([{ volume: 100 }]), 0);
});

test("opening-range strategy is gated until the range completes", () => {
  const today = todayIst();
  const fewCandles = Array.from({ length: 3 }, (_, index) => ({
    time: `${today}T09:${String(15 + index * 5).padStart(2, "0")}:00+05:30`,
    open: 1500,
    high: 1505,
    low: 1495,
    close: 1502 + index,
    volume: 50000,
  }));
  const signals = generateSignals({
    quotes: [
      quote("NIFTY 50", "Index", 23100, 23000),
      quote("INFY", "IT Services", 1530, 1500),
    ],
    candlesBySymbol: { INFY: fewCandles },
    config: {
      ...defaultEngineConfig,
      strategyMode: "opening-range",
      minScore: 1,
      minMomentumPct: 0,
      minRelativeStrengthPct: -100,
      minNetRewardRisk: -5,
      maxGapPct: 99,
    },
    asOf: `${today}T09:30:00+05:30`,
  });
  const infy = signals.find((signal) => signal.symbol === "INFY");
  strictEqual(infy.eligible, false);
  ok(
    infy.gateReasons.some((reason) => reason.startsWith("opening range forming")),
    infy.gateReasons.join(", ")
  );
  strictEqual(infy.strategyScore, 0, "ORB candidates must score zero before the range completes");
});

test("single-stock sectors do not get the sector-strength bonus", () => {
  const baseQuotes = [
    quote("NIFTY 50", "Index", 23000, 23000),
    quote("BHARTIARTL", "Telecom", 1515, 1500),
    quote("INFY", "IT Services", 3900, 3900),
    quote("TCS", "IT Services", 3900, 3900),
  ];
  const soloRun = generateSignals({ quotes: baseQuotes, candlesBySymbol: {}, config: defaultEngineConfig });
  // Same setup, but Telecom now has a flat second member -> bonus applies.
  const pairedQuotes = baseQuotes.map((item) =>
    item.symbol === "INFY" ? { ...item, sector: "Telecom" } : item
  );
  const pairedRun = generateSignals({ quotes: pairedQuotes, candlesBySymbol: {}, config: defaultEngineConfig });
  const soloScore = soloRun.find((signal) => signal.symbol === "BHARTIARTL").score;
  const pairedScore = pairedRun.find((signal) => signal.symbol === "BHARTIARTL").score;
  strictEqual(pairedScore - soloScore, 5, `expected exactly the +5 sector bonus, got ${pairedScore - soloScore}`);
});

// --- live engine trade management ---

const openSession = {
  date: "2026-06-11",
  marketOpen: true,
  freshEntriesAllowed: true,
  squareOffDue: false,
  botArmAllowed: true,
  reason: "Trading session",
};

function managedInput(price, positionOverrides = {}) {
  return {
    status: "running",
    config: defaultEngineConfig,
    session: openSession,
    killSwitchActive: false,
    realizedToday: 0,
    tradesTaken: 1,
    positions: [
      {
        id: "pos-1",
        status: "OPEN",
        symbol: "INFY",
        side: "LONG",
        quantity: 10,
        entryPrice: 1500,
        entryAt: "2026-06-11T09:30:00+05:30",
        tradeDate: "2026-06-11",
        stopLoss: 1488,
        initialStop: 1488,
        target: 1560,
        strategy: "momentum",
        score: 80,
        lastPrice: 1500,
        mfe: 0,
        mae: 0,
        ...positionOverrides,
      },
    ],
    strategy: {
      source: "kite-ws",
      decision: { action: "WAIT", reason: "holding" },
      signals: [{ symbol: "INFY", price }],
    },
    now: "2026-06-11T10:00:00+05:30",
  };
}

test("breakeven stop engages at +0.5R", () => {
  // Risk/share 12; +7 move >= 0.5R(6) -> stop to entry.
  const result = applyTick(managedInput(1507));
  strictEqual(result.marks.length, 1);
  strictEqual(result.marks[0].stopLoss, 1500);
});

test("trailing stop locks half of MFE past +1R for momentum", () => {
  // +20 move >= 1R(12) -> stop = entry + 20*0.5 = 1510.
  const result = applyTick(managedInput(1520));
  strictEqual(result.marks[0].stopLoss, 1510);
});

test("stops never loosen", () => {
  // Already trailed to 1515; a smaller MFE must not pull it back.
  const result = applyTick(managedInput(1512, { stopLoss: 1515, mfe: 30 }));
  strictEqual(result.marks[0].stopLoss, 1515);
});

test("mean reversion does not trail", () => {
  const result = applyTick(managedInput(1520, { strategy: "mean-reversion", target: 1525 }));
  // breakeven applies (>= 0.6R), but no trailing lock above entry.
  strictEqual(result.marks[0].stopLoss, 1500);
});
