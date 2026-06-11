import { ok, strictEqual } from "node:assert";
import { test } from "node:test";
import { charges, dailyActivity, reconstructTrades, tradeHistory } from "../server/ledger.js";

function paperEvent(fill) {
  return {
    id: fill.orderId,
    type: "orders.paper",
    createdAt: fill.createdAt,
    payload: { mode: "paper", status: "COMPLETE", product: "MIS", exchange: "NSE", ...fill },
  };
}

function rejectedEvent(order) {
  return {
    id: `rej-${Date.now()}`,
    type: "orders.rejected",
    createdAt: order.createdAt,
    payload: { order, errors: ["test"], mode: "paper" },
  };
}

test("charges match the NSE intraday model", () => {
  const value = charges(100000, 100000);
  // brokerage 20+20 capped at 0.03%, STT 25 on sell, txn 5.94, sebi 0.2,
  // stamp 3, gst 18% on (brokerage+txn+sebi)
  const expected = 40 + 25 + 5.94 + 0.2 + 3 + (40 + 5.94 + 0.2) * 0.18;
  ok(Math.abs(value - expected) < 0.01, `expected ~${expected}, got ${value}`);
});

test("long round trip produces correct net P&L", () => {
  const events = [
    paperEvent({
      orderId: "E1",
      tradingsymbol: "INFY",
      transactionType: "BUY",
      quantity: 10,
      averagePrice: 1500,
      intent: "ENTRY",
      positionSide: "LONG",
      createdAt: "2026-06-11T09:30:00+05:30",
    }),
    paperEvent({
      orderId: "X1",
      tradingsymbol: "INFY",
      transactionType: "SELL",
      quantity: 10,
      averagePrice: 1520,
      intent: "EXIT",
      positionSide: "LONG",
      createdAt: "2026-06-11T11:00:00+05:30",
    }),
  ];
  const { closedTrades, openTrades } = reconstructTrades(events, 50000);
  strictEqual(closedTrades.length, 1);
  strictEqual(openTrades.length, 0);
  const trade = closedTrades[0];
  strictEqual(trade.side, "LONG");
  strictEqual(trade.grossPnl, 200);
  const expectedCharges = charges(15000, 15200);
  ok(Math.abs(trade.netPnl - (200 - expectedCharges)) < 0.01);
  strictEqual(trade.date, "2026-06-11");
});

test("short round trip computes inverse P&L", () => {
  const events = [
    paperEvent({
      orderId: "E2",
      tradingsymbol: "SBIN",
      transactionType: "SELL",
      quantity: 20,
      averagePrice: 800,
      intent: "ENTRY",
      positionSide: "SHORT",
      createdAt: "2026-06-11T10:00:00+05:30",
    }),
    paperEvent({
      orderId: "X2",
      tradingsymbol: "SBIN",
      transactionType: "BUY",
      quantity: 20,
      averagePrice: 790,
      intent: "EXIT",
      positionSide: "SHORT",
      createdAt: "2026-06-11T12:00:00+05:30",
    }),
  ];
  const { closedTrades } = reconstructTrades(events, 50000);
  strictEqual(closedTrades.length, 1);
  strictEqual(closedTrades[0].side, "SHORT");
  strictEqual(closedTrades[0].grossPnl, 200);
});

test("partial exits match lots LIFO and leave remainder open", () => {
  const events = [
    paperEvent({
      orderId: "E3",
      tradingsymbol: "TCS",
      transactionType: "BUY",
      quantity: 10,
      averagePrice: 4000,
      intent: "ENTRY",
      positionSide: "LONG",
      createdAt: "2026-06-11T09:30:00+05:30",
    }),
    paperEvent({
      orderId: "X3",
      tradingsymbol: "TCS",
      transactionType: "SELL",
      quantity: 4,
      averagePrice: 4040,
      intent: "EXIT",
      positionSide: "LONG",
      createdAt: "2026-06-11T10:30:00+05:30",
    }),
  ];
  const { closedTrades, openTrades } = reconstructTrades(events, 50000);
  strictEqual(closedTrades.length, 1);
  strictEqual(closedTrades[0].quantity, 4);
  strictEqual(openTrades.length, 1);
  strictEqual(openTrades[0].quantity, 6);
  strictEqual(openTrades[0].status, "OPEN");
});

test("rejected orders are counted, not matched", () => {
  const events = [
    rejectedEvent({
      tradingsymbol: "INFY",
      transactionType: "BUY",
      quantity: 5,
      price: 1500,
      createdAt: "2026-06-11T09:30:00+05:30",
    }),
  ];
  const { closedTrades, openTrades, rejectedOrders } = reconstructTrades(events, 50000);
  strictEqual(closedTrades.length, 0);
  strictEqual(openTrades.length, 0);
  strictEqual(rejectedOrders, 1);
});

test("dailyActivity derives realized P&L and trades taken from the ledger only", () => {
  const events = [
    paperEvent({
      orderId: "E4",
      tradingsymbol: "INFY",
      transactionType: "BUY",
      quantity: 10,
      averagePrice: 1500,
      intent: "ENTRY",
      positionSide: "LONG",
      createdAt: "2026-06-11T09:30:00+05:30",
    }),
    paperEvent({
      orderId: "X4",
      tradingsymbol: "INFY",
      transactionType: "SELL",
      quantity: 10,
      averagePrice: 1490,
      intent: "EXIT",
      positionSide: "LONG",
      createdAt: "2026-06-11T11:00:00+05:30",
    }),
    // A trade from another day must not count today.
    paperEvent({
      orderId: "E5",
      tradingsymbol: "SBIN",
      transactionType: "BUY",
      quantity: 5,
      averagePrice: 800,
      intent: "ENTRY",
      positionSide: "LONG",
      createdAt: "2026-06-10T09:30:00+05:30",
    }),
  ];
  const activity = dailyActivity("2026-06-11", { capital: 50000, events });
  strictEqual(activity.tradesTaken, 1);
  ok(activity.realizedPnl < -100, `loss with charges expected, got ${activity.realizedPnl}`);
  strictEqual(activity.closedTrades, 1);
});

test("tradeHistory totals add up", () => {
  const events = [
    paperEvent({
      orderId: "E6",
      tradingsymbol: "INFY",
      transactionType: "BUY",
      quantity: 10,
      averagePrice: 1500,
      intent: "ENTRY",
      positionSide: "LONG",
      createdAt: "2026-06-11T09:30:00+05:30",
    }),
    paperEvent({
      orderId: "X6",
      tradingsymbol: "INFY",
      transactionType: "SELL",
      quantity: 10,
      averagePrice: 1530,
      intent: "EXIT",
      positionSide: "LONG",
      createdAt: "2026-06-11T11:00:00+05:30",
    }),
  ];
  const history = tradeHistory({ capital: 50000, events });
  strictEqual(history.totals.closedTrades, 1);
  strictEqual(history.totals.wins, 1);
  strictEqual(history.daily.length, 1);
  ok(Math.abs(history.totals.netPnl - history.daily[0].netPnl) < 0.001);
});
