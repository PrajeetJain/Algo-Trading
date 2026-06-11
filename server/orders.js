import { appendEvent, readEvents, readJson, saveJson } from "./database.js";
import { recordTradeImpact, validateOrder, validatePaperOrder } from "./riskGuard.js";

const dedupeName = "order-dedupe.json";
const marketTimeZone = "Asia/Kolkata";

function dedupeKey(order) {
  return order.clientOrderId || order.tag || `${order.transactionType}:${order.exchange}:${order.tradingsymbol}:${order.quantity}:${order.price ?? order.estimatedPrice ?? ""}`;
}

function readDedupe() {
  return readJson(dedupeName, { orders: {} });
}

function rememberOrder(key, result) {
  const store = readDedupe();
  store.orders[key] = {
    result,
    updatedAt: new Date().toISOString(),
  };
  const entries = Object.entries(store.orders).slice(-300);
  saveJson(dedupeName, { orders: Object.fromEntries(entries) });
}

function duplicateOrder(key) {
  const store = readDedupe();
  return store.orders[key]?.result ?? null;
}

function isEntryOrder(order) {
  if (order.intent) {
    return order.intent === "ENTRY";
  }
  return order.transactionType === "BUY";
}

function charges(buyValue, sellValue) {
  const turnover = buyValue + sellValue;
  const brokerage = Math.min(20, buyValue * 0.0003) + Math.min(20, sellValue * 0.0003);
  const stt = sellValue * 0.00025;
  const exchangeTxn = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = buyValue * 0.00003;
  const gst = (brokerage + exchangeTxn + sebi) * 0.18;
  return brokerage + stt + exchangeTxn + sebi + stamp + gst;
}

function marketDate(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: marketTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function normalizeOrderEvent(event) {
  const payload = event.payload ?? {};
  const result = payload.result ?? payload;
  const order = payload.order ?? {};
  const status = event.type === "orders.rejected" ? "REJECTED" : (result.status ?? "UNKNOWN");
  const createdAt = result.createdAt ?? event.createdAt;
  return {
    orderId: result.orderId ?? result.order_id ?? order.orderId ?? event.id,
    mode: result.mode ?? payload.mode ?? "paper",
    status,
    exchange: result.exchange ?? order.exchange ?? "NSE",
    symbol: result.tradingsymbol ?? order.tradingsymbol ?? "",
    transactionType: result.transactionType ?? order.transactionType ?? "BUY",
    quantity: Number(result.quantity ?? result.filledQuantity ?? order.quantity ?? 0),
    averagePrice: Number(result.averagePrice ?? result.average_price ?? order.price ?? order.estimatedPrice ?? 0),
    product: result.product ?? order.product ?? "MIS",
    intent: result.intent ?? order.intent ?? null,
    positionSide: result.positionSide ?? order.positionSide ?? null,
    strategy: result.strategy ?? order.strategy ?? "unknown",
    score: Number(result.score ?? order.score ?? 0),
    stopLossPrice: Number(result.stopLossPrice ?? order.stopLossPrice ?? 0),
    targetPrice: Number(result.targetPrice ?? order.targetPrice ?? 0),
    clientOrderId: result.clientOrderId ?? order.clientOrderId ?? result.tag ?? "",
    createdAt,
  };
}

function matchingExitSide(transactionType) {
  return transactionType === "SELL" ? "LONG" : "SHORT";
}

function oppositeSide(side) {
  return side === "LONG" ? "SHORT" : "LONG";
}

function inferIntent(order, openLots) {
  if (order.intent === "ENTRY" || order.intent === "EXIT") {
    return order.intent;
  }
  const likelyExitSide = matchingExitSide(order.transactionType);
  const hasLikelyOpenLot = openLots.some(
    (lot) => lot.symbol === order.symbol && lot.side === likelyExitSide && lot.remainingQuantity > 0
  );
  return hasLikelyOpenLot ? "EXIT" : "ENTRY";
}

function entryPositionSide(order) {
  if (order.positionSide === "LONG" || order.positionSide === "SHORT") {
    return order.positionSide;
  }
  return order.transactionType === "SELL" ? "SHORT" : "LONG";
}

function exitPositionSide(order, openLots) {
  if (order.positionSide === "LONG" || order.positionSide === "SHORT") {
    return order.positionSide;
  }
  const likelySide = matchingExitSide(order.transactionType);
  const hasLikelyOpenLot = openLots.some(
    (lot) => lot.symbol === order.symbol && lot.side === likelySide && lot.remainingQuantity > 0
  );
  return hasLikelyOpenLot ? likelySide : oppositeSide(likelySide);
}

function buildDailySummaries(trades, capital) {
  const daily = new Map();
  for (const trade of trades.filter((item) => item.status === "CLOSED")) {
    const summary = daily.get(trade.date) ?? {
      date: trade.date,
      trades: 0,
      wins: 0,
      losses: 0,
      grossPnl: 0,
      charges: 0,
      netPnl: 0,
      netPct: 0,
    };
    summary.trades += 1;
    summary.wins += trade.netPnl > 0 ? 1 : 0;
    summary.losses += trade.netPnl < 0 ? 1 : 0;
    summary.grossPnl += trade.grossPnl;
    summary.charges += trade.charges;
    summary.netPnl += trade.netPnl;
    summary.netPct = capital ? (summary.netPnl / capital) * 100 : 0;
    daily.set(trade.date, summary);
  }
  return [...daily.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function paperOrder(order, quote, context = null) {
  const key = dedupeKey(order);
  const duplicate = duplicateOrder(key);
  if (duplicate) {
    appendEvent("orders.duplicate", { key, mode: "paper" });
    return { ...duplicate, duplicate: true };
  }

  if (context) {
    const validation = validatePaperOrder(order, context);
    if (!validation.ok) {
      const rejection = {
        orderId: `PAPER-REJECT-${Date.now()}`,
        mode: "paper",
        status: "REJECTED",
        exchange: order.exchange ?? "NSE",
        tradingsymbol: order.tradingsymbol,
        transactionType: order.transactionType ?? "BUY",
        quantity: Number(order.quantity ?? 0),
        averagePrice: Number(order.price ?? quote?.ltp ?? 0),
        product: order.product ?? "MIS",
        intent: order.intent ?? (order.transactionType === "BUY" ? "ENTRY" : "EXIT"),
        positionSide: order.positionSide ?? (order.transactionType === "SELL" ? "SHORT" : "LONG"),
        strategy: order.strategy ?? "unknown",
        score: Number(order.score ?? 0),
        stopLossPrice: Number(order.stopLossPrice ?? 0),
        targetPrice: Number(order.targetPrice ?? 0),
        clientOrderId: key,
        errors: validation.errors,
        createdAt: new Date().toISOString(),
      };
      appendEvent("orders.rejected", { order, errors: validation.errors, mode: "paper" });
      rememberOrder(key, rejection);
      return rejection;
    }
  }

  const side = order.transactionType ?? "BUY";
  const quantity = Number(order.quantity ?? 0);
  const price = Number(order.price ?? quote?.ltp ?? 0);
  const fill = {
    orderId: `PAPER-${Date.now()}`,
    mode: "paper",
    status: "COMPLETE",
    exchange: order.exchange ?? "NSE",
    tradingsymbol: order.tradingsymbol,
    transactionType: side,
    quantity,
    averagePrice: price,
    product: order.product ?? "MIS",
    intent: order.intent ?? (side === "BUY" ? "ENTRY" : "EXIT"),
    positionSide: order.positionSide ?? (side === "SELL" ? "SHORT" : "LONG"),
    strategy: order.strategy ?? "unknown",
    score: Number(order.score ?? 0),
    stopLossPrice: Number(order.stopLossPrice ?? 0),
    targetPrice: Number(order.targetPrice ?? 0),
    clientOrderId: key,
    createdAt: new Date().toISOString(),
  };
  appendEvent("orders.paper", fill);
  rememberOrder(key, fill);
  recordTradeImpact({ pnl: Number(order.pnl ?? 0), countTrade: isEntryOrder(order) });
  return fill;
}

export async function liveOrder(kiteClient, order, context) {
  const key = dedupeKey(order);
  const duplicate = duplicateOrder(key);
  if (duplicate) {
    appendEvent("orders.duplicate", { key, mode: "live" });
    return { ...duplicate, duplicate: true };
  }

  const validation = validateOrder(order, context);
  if (!validation.ok) {
    appendEvent("orders.rejected", { order, errors: validation.errors });
    return {
      status: "REJECTED",
      errors: validation.errors,
    };
  }
  const result = await kiteClient.placeOrder({
    ...order,
    tag: order.tag ?? key.slice(0, 20),
  });
  const orderId = result.order_id ?? result.orderId;
  const status = orderId ? await kiteClient.waitForOrderStatus(orderId) : null;
  const payload = {
    ...result,
    clientOrderId: key,
    strategy: order.strategy ?? "unknown",
    score: Number(order.score ?? 0),
    intent: order.intent ?? null,
    positionSide: order.positionSide ?? null,
    stopLossPrice: Number(order.stopLossPrice ?? 0),
    targetPrice: Number(order.targetPrice ?? 0),
    status: status?.status ?? result.status ?? "PLACED",
    filledQuantity: status?.filled_quantity ?? 0,
    pendingQuantity: status?.pending_quantity ?? 0,
    averagePrice: status?.average_price ?? 0,
  };
  appendEvent("orders.live", { order, result: payload });
  rememberOrder(key, payload);
    recordTradeImpact({ pnl: 0, countTrade: isEntryOrder(order) });
  return payload;
}

export function orderEvents(limit = 100) {
  return readEvents(limit).filter((event) => event.type.startsWith("orders."));
}

export function tradeHistory({ capital = 10000, limit = 50000 } = {}) {
  const events = readEvents(limit)
    .filter((event) => event.type === "orders.paper" || event.type === "orders.live" || event.type === "orders.rejected")
    .map(normalizeOrderEvent)
    .filter((order) => order.symbol)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const openLots = [];
  const closedTrades = [];
  const rejectedOrders = events.filter((order) => order.status === "REJECTED").length;

  for (const order of events) {
    if (order.status !== "COMPLETE") {
      continue;
    }

    const intent = inferIntent(order, openLots);
    if (intent === "ENTRY") {
      openLots.push({
        symbol: order.symbol,
        side: entryPositionSide(order),
        quantity: order.quantity,
        remainingQuantity: order.quantity,
        entryPrice: order.averagePrice,
        entryAt: order.createdAt,
        entryOrderId: order.orderId,
        clientOrderId: order.clientOrderId,
        mode: order.mode,
        strategy: order.strategy ?? "unknown",
        entryScore: order.score ?? 0,
        stopLossPrice: order.stopLossPrice || null,
        targetPrice: order.targetPrice || null,
      });
      continue;
    }

    const side = exitPositionSide(order, openLots);
    let remainingExitQuantity = order.quantity;
    for (let index = openLots.length - 1; index >= 0; index -= 1) {
      const lot = openLots[index];
      if (remainingExitQuantity <= 0) {
        break;
      }
      if (lot.symbol !== order.symbol || lot.side !== side || lot.remainingQuantity <= 0) {
        continue;
      }
      const quantity = Math.min(lot.remainingQuantity, remainingExitQuantity);
      const entryValue = lot.entryPrice * quantity;
      const exitValue = order.averagePrice * quantity;
      const buyValue = side === "SHORT" ? exitValue : entryValue;
      const sellValue = side === "SHORT" ? entryValue : exitValue;
      const tradeCharges = charges(buyValue, sellValue);
      const grossPnl = side === "SHORT" ? entryValue - exitValue : exitValue - entryValue;
      const netPnl = grossPnl - tradeCharges;
      const notional = Math.max(buyValue, sellValue);
      closedTrades.push({
        id: `${lot.entryOrderId}-${order.orderId}-${quantity}`,
        date: marketDate(order.createdAt),
        symbol: order.symbol,
        side,
        quantity,
        entryAt: lot.entryAt,
        exitAt: order.createdAt,
        entryPrice: lot.entryPrice,
        exitPrice: order.averagePrice,
        buyValue,
        sellValue,
        grossPnl,
        charges: tradeCharges,
        netPnl,
        netPct: notional ? (netPnl / notional) * 100 : 0,
        capitalPct: capital ? (netPnl / capital) * 100 : 0,
        mode: order.mode,
        strategy: lot.strategy ?? "unknown",
        entryScore: lot.entryScore ?? 0,
        exitScore: order.score ?? 0,
        stopLossPrice: lot.stopLossPrice,
        targetPrice: lot.targetPrice,
        status: "CLOSED",
      });
      lot.remainingQuantity -= quantity;
      remainingExitQuantity -= quantity;
    }
  }

  const openTrades = openLots
    .filter((lot) => lot.remainingQuantity > 0)
    .map((lot) => ({
      id: `${lot.entryOrderId}-open`,
      date: marketDate(lot.entryAt),
      symbol: lot.symbol,
      side: lot.side,
      quantity: lot.remainingQuantity,
      entryAt: lot.entryAt,
      exitAt: null,
      entryPrice: lot.entryPrice,
      exitPrice: null,
      buyValue: lot.side === "SHORT" ? 0 : lot.entryPrice * lot.remainingQuantity,
      sellValue: lot.side === "SHORT" ? lot.entryPrice * lot.remainingQuantity : 0,
      grossPnl: 0,
      charges: 0,
      netPnl: 0,
      netPct: 0,
      capitalPct: 0,
      mode: lot.mode,
      strategy: lot.strategy ?? "unknown",
      entryScore: lot.entryScore ?? 0,
      exitScore: 0,
      stopLossPrice: lot.stopLossPrice,
      targetPrice: lot.targetPrice,
      status: "OPEN",
    }));

  const trades = [...closedTrades, ...openTrades].sort(
    (a, b) => new Date(b.exitAt ?? b.entryAt).getTime() - new Date(a.exitAt ?? a.entryAt).getTime()
  );
  const totals = closedTrades.reduce(
    (summary, trade) => ({
      closedTrades: summary.closedTrades + 1,
      openTrades: summary.openTrades,
      rejectedOrders,
      wins: summary.wins + (trade.netPnl > 0 ? 1 : 0),
      losses: summary.losses + (trade.netPnl < 0 ? 1 : 0),
      grossPnl: summary.grossPnl + trade.grossPnl,
      charges: summary.charges + trade.charges,
      netPnl: summary.netPnl + trade.netPnl,
      netPct: 0,
      winRate: 0,
    }),
    {
      closedTrades: 0,
      openTrades: openTrades.length,
      rejectedOrders,
      wins: 0,
      losses: 0,
      grossPnl: 0,
      charges: 0,
      netPnl: 0,
      netPct: 0,
      winRate: 0,
    }
  );
  totals.netPct = capital ? (totals.netPnl / capital) * 100 : 0;
  totals.winRate = totals.closedTrades ? (totals.wins / totals.closedTrades) * 100 : 0;

  return {
    generatedAt: new Date().toISOString(),
    capital,
    trades,
    daily: buildDailySummaries(closedTrades, capital),
    totals,
  };
}
