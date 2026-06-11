import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { validateOrder } from "../server/riskGuard.js";

const config = {
  capital: 50000,
  targetPct: 1,
  maxLossPct: 0.5,
  maxTrades: 2,
};

const openSession = {
  marketOpen: true,
  freshEntriesAllowed: true,
  date: "2026-06-11",
};

const closedSession = {
  marketOpen: false,
  freshEntriesAllowed: false,
  date: "2026-06-11",
};

function entryOrder(overrides = {}) {
  return {
    exchange: "NSE",
    tradingsymbol: "INFY",
    transactionType: "BUY",
    quantity: 10,
    price: 1500,
    product: "MIS",
    intent: "ENTRY",
    ...overrides,
  };
}

function baseContext(overrides = {}) {
  return {
    config,
    mode: "paper",
    session: openSession,
    killSwitchActive: false,
    dayPnl: 0,
    tradesTaken: 0,
    ...overrides,
  };
}

test("valid paper entry passes", () => {
  const result = validateOrder(entryOrder(), baseContext());
  deepStrictEqual(result, { ok: true, errors: [] });
});

test("entry blocked when market is closed", () => {
  const result = validateOrder(entryOrder(), baseContext({ session: closedSession }));
  ok(result.errors.includes("Indian cash market is closed"));
});

test("exit allowed when market closed with allowOutsideMarket", () => {
  const exit = entryOrder({ transactionType: "SELL", intent: "EXIT" });
  const result = validateOrder(exit, baseContext({ session: closedSession, allowOutsideMarket: true }));
  strictEqual(result.ok, true);
});

test("kill switch blocks entries but not exits", () => {
  const entry = validateOrder(entryOrder(), baseContext({ killSwitchActive: true }));
  ok(entry.errors.includes("Kill switch is active"));
  const exit = validateOrder(
    entryOrder({ transactionType: "SELL", intent: "EXIT" }),
    baseContext({ killSwitchActive: true })
  );
  strictEqual(exit.ok, true);
});

test("max trades blocks new entries", () => {
  const result = validateOrder(entryOrder(), baseContext({ tradesTaken: 2 }));
  ok(result.errors.includes("Max trades reached"));
});

test("daily loss limit blocks new entries", () => {
  const result = validateOrder(entryOrder(), baseContext({ dayPnl: -250 }));
  ok(result.errors.includes("Daily loss limit reached"));
});

test("entry above capital allocation is rejected", () => {
  const result = validateOrder(entryOrder({ quantity: 100, price: 1500 }), baseContext());
  ok(result.errors.includes("Order exceeds daily capital allocation"));
});

test("only NSE MIS BUY/SELL orders are accepted", () => {
  ok(validateOrder(entryOrder({ exchange: "BSE" }), baseContext()).errors.includes("Only NSE cash symbols are allowed"));
  ok(
    validateOrder(entryOrder({ product: "CNC" }), baseContext()).errors.includes("Only MIS intraday product is allowed")
  );
  ok(
    validateOrder(entryOrder({ transactionType: "SHORT" }), baseContext()).errors.includes(
      "Transaction type must be BUY or SELL"
    )
  );
  ok(validateOrder(entryOrder({ quantity: 0 }), baseContext()).errors.includes("Quantity must be positive"));
});

test("live mode requires token and explicit enablement", () => {
  const result = validateOrder(entryOrder(), baseContext({ mode: "live", tokenReady: false, liveTradingEnabled: false }));
  ok(result.errors.includes("Kite token is missing"));
  ok(result.errors.includes("LIVE_TRADING_ENABLED is false"));
  const paper = validateOrder(entryOrder(), baseContext({ mode: "paper" }));
  strictEqual(paper.ok, true);
});
