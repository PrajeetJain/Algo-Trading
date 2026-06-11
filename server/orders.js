import { appendEvent, readEvents, readJson, saveJson } from "./database.js";
import { tradeHistory } from "./ledger.js";
import { validateOrder } from "./riskGuard.js";

export { tradeHistory };

const dedupeName = "order-dedupe.json";

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

/**
 * Records a paper fill in the ledger. Day P&L and trade counts are derived
 * from the ledger itself (see riskGuard/ledger) — any `pnl` field a client
 * sends is ignored, so a buggy or malicious caller cannot skew risk state.
 */
export function paperOrder(order, quote, context = null) {
  const key = dedupeKey(order);
  const duplicate = duplicateOrder(key);
  if (duplicate) {
    appendEvent("orders.duplicate", { key, mode: "paper" });
    return { ...duplicate, duplicate: true };
  }

  if (context) {
    const validation = validateOrder(order, { ...context, mode: "paper" });
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
    orderId: `PAPER-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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
  return fill;
}

export async function liveOrder(kiteClient, order, context) {
  const key = dedupeKey(order);
  const duplicate = duplicateOrder(key);
  if (duplicate) {
    appendEvent("orders.duplicate", { key, mode: "live" });
    return { ...duplicate, duplicate: true };
  }

  const validation = validateOrder(order, { ...context, mode: "live" });
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
  return payload;
}

export function orderEvents(limit = 100) {
  return readEvents(limit).filter((event) => event.type.startsWith("orders."));
}
