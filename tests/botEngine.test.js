import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { applyTick, defaultEngineConfig, exitFill } from "../server/botEngine.js";

// Pin capital so daily target/loss thresholds (0.75% = 375) stay small
// enough for the fixture positions to trip them, regardless of defaults.
const config = { ...defaultEngineConfig, capital: 50000 };

const openSession = {
  date: "2026-06-11",
  marketOpen: true,
  freshEntriesAllowed: true,
  squareOffDue: false,
  botArmAllowed: true,
  reason: "Trading session",
};

function strategyWith({ source = "kite-ws", action = "WAIT", symbol = "INFY", price = 1500, signals = null } = {}) {
  const signal = {
    symbol,
    price,
    side: "BUY",
    eligible: action === "TRADE",
    strategy: "momentum",
    score: 80,
    recommendedQuantity: 10,
    stopLossPrice: price * 0.992,
    targetPrice: price * 1.016,
  };
  return {
    source,
    decision:
      action === "TRADE"
        ? { action, symbol, side: "BUY", quantity: 10, stopLossPrice: signal.stopLossPrice, targetPrice: signal.targetPrice, reason: "test trade" }
        : { action, reason: "waiting" },
    signals: signals ?? [signal],
  };
}

function openPosition(overrides = {}) {
  return {
    id: "pos-1",
    status: "OPEN",
    symbol: "INFY",
    side: "LONG",
    quantity: 10,
    entryPrice: 1500,
    entryAt: "2026-06-11T09:30:00+05:30",
    tradeDate: "2026-06-11",
    stopLoss: 1488,
    target: 1524,
    strategy: "momentum",
    score: 80,
    lastPrice: 1500,
    mfe: 0,
    mae: 0,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    status: "running",
    config,
    session: openSession,
    killSwitchActive: false,
    realizedToday: 0,
    tradesTaken: 0,
    positions: [],
    strategy: strategyWith(),
    now: "2026-06-11T10:00:00+05:30",
    ...overrides,
  };
}

test("enters a position when decision is TRADE and signal eligible", () => {
  const result = applyTick(baseInput({ strategy: strategyWith({ action: "TRADE" }) }));
  ok(result.entry, "expected an entry");
  strictEqual(result.entry.symbol, "INFY");
  strictEqual(result.entry.side, "LONG");
  strictEqual(result.entry.quantity, 10);
  ok(result.entry.entryPrice > 1500, "long entry price includes slippage");
});

test("never enters on simulator data", () => {
  const result = applyTick(baseInput({ strategy: strategyWith({ action: "TRADE", source: "simulator" }) }));
  strictEqual(result.entry, null);
  ok(result.message.includes("unverified"), result.message);
});

test("never enters when max trades reached", () => {
  const result = applyTick(baseInput({ strategy: strategyWith({ action: "TRADE" }), tradesTaken: 2 }));
  strictEqual(result.entry, null);
  ok(result.message.includes("max trades"), result.message);
});

test("never enters while a position is open", () => {
  const result = applyTick(
    baseInput({ strategy: strategyWith({ action: "TRADE", symbol: "SBIN", price: 800 }), positions: [openPosition()] })
  );
  strictEqual(result.entry, null);
});

test("stop-loss exit triggers on adverse price", () => {
  const strategy = strategyWith({ signals: [{ symbol: "INFY", price: 1480 }] });
  const result = applyTick(baseInput({ positions: [openPosition()], strategy }));
  strictEqual(result.exits.length, 1);
  strictEqual(result.exits[0].reason, "stop-loss");
  ok(result.exits[0].fill.netPnl < 0);
});

test("target exit triggers on favorable price", () => {
  const strategy = strategyWith({ signals: [{ symbol: "INFY", price: 1530 }] });
  const result = applyTick(baseInput({ positions: [openPosition()], strategy }));
  strictEqual(result.exits.length, 1);
  strictEqual(result.exits[0].reason, "target");
  ok(result.exits[0].fill.netPnl > 0);
});

test("stops are not evaluated on untrusted data", () => {
  const strategy = strategyWith({ source: "simulator", signals: [{ symbol: "INFY", price: 1400 }] });
  const result = applyTick(baseInput({ positions: [openPosition()], strategy }));
  strictEqual(result.exits.length, 0);
  ok(result.message.includes("stops are not being evaluated"), result.message);
});

test("square-off window closes everything", () => {
  const result = applyTick(
    baseInput({ positions: [openPosition()], session: { ...openSession, squareOffDue: true, freshEntriesAllowed: false } })
  );
  strictEqual(result.exits.length, 1);
  strictEqual(result.exits[0].reason, "square-off");
  strictEqual(result.status, "closed");
});

test("daily loss limit closes positions and locks the day", () => {
  // Position deep underwater: 10 x (1500 -> 1450) is well past the 250 limit.
  const strategy = strategyWith({ signals: [{ symbol: "INFY", price: 1450 }] });
  const result = applyTick(baseInput({ positions: [openPosition({ stopLoss: 1400 })], strategy }));
  strictEqual(result.status, "loss-hit");
  strictEqual(result.exits[0].reason, "daily-loss");
});

test("daily target closes positions and locks the day", () => {
  const strategy = strategyWith({ signals: [{ symbol: "INFY", price: 1560 }] });
  const result = applyTick(baseInput({ positions: [openPosition({ target: 1600 })], strategy }));
  strictEqual(result.status, "target-hit");
  strictEqual(result.exits[0].reason, "daily-target");
});

test("kill switch squares off and stops the bot", () => {
  const result = applyTick(baseInput({ positions: [openPosition()], killSwitchActive: true }));
  strictEqual(result.status, "closed");
  strictEqual(result.exits[0].reason, "kill-switch");
});

test("paused bot takes no entries but still squares off", () => {
  const noEntry = applyTick(baseInput({ status: "paused", strategy: strategyWith({ action: "TRADE" }) }));
  strictEqual(noEntry.entry, null);
  const squareOff = applyTick(
    baseInput({
      status: "paused",
      positions: [openPosition()],
      session: { ...openSession, squareOffDue: true, freshEntriesAllowed: false },
    })
  );
  strictEqual(squareOff.exits.length, 1);
});

test("market fully closed stops the bot", () => {
  const result = applyTick(
    baseInput({
      positions: [openPosition()],
      session: { ...openSession, marketOpen: false, botArmAllowed: false, freshEntriesAllowed: false, reason: "Outside market hours" },
    })
  );
  strictEqual(result.status, "closed");
  strictEqual(result.exits[0].reason, "market-closed");
});

test("MFE/MAE marks track per-share excursion", () => {
  const up = applyTick(baseInput({ positions: [openPosition()], strategy: strategyWith({ signals: [{ symbol: "INFY", price: 1510 }] }) }));
  strictEqual(up.marks.length, 1);
  strictEqual(up.marks[0].mfe, 10);
  strictEqual(up.marks[0].mae, 0);
  const down = applyTick(
    baseInput({ positions: [openPosition({ stopLoss: 1480 })], strategy: strategyWith({ signals: [{ symbol: "INFY", price: 1495 }] }) })
  );
  strictEqual(down.marks[0].mae, 5);
});

test("exitFill applies slippage and charges symmetrically", () => {
  const position = openPosition();
  const fill = exitFill(position, 1520, config);
  ok(fill.exitPrice < 1520, "long exit pays slippage");
  ok(fill.netPnl < fill.grossPnl, "charges reduce net");
  const shortFill = exitFill(openPosition({ side: "SHORT", entryPrice: 1520 }), 1500, config);
  ok(shortFill.exitPrice > 1500, "short exit pays slippage upward");
  ok(shortFill.grossPnl > 0);
});
