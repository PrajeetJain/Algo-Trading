import { appendEvent, readJson, saveJson } from "./database.js";
import { dailyActivity } from "./ledger.js";
import { getMarketSession } from "./marketCalendar.js";

const killSwitchName = "kill-switch.json";

function isEntryOrder(order) {
  if (order.intent) {
    return order.intent === "ENTRY";
  }
  return order.transactionType === "BUY";
}

export function killSwitchState() {
  const stored = readJson(killSwitchName, { active: false, reason: "", updatedAt: null });
  return Boolean(stored.active);
}

export function setKillSwitch(active, reason = "manual") {
  const state = {
    active: Boolean(active),
    reason,
    updatedAt: new Date().toISOString(),
  };
  saveJson(killSwitchName, state);
  appendEvent("risk.kill_switch", { active: state.active, reason });
  return state;
}

// Day P&L and trades taken are derived from the immutable order ledger —
// never from client-supplied numbers. A server restart loses nothing.
export function getRiskState(config) {
  const session = getMarketSession();
  const activity = dailyActivity(session.date, { capital: config.capital });
  return {
    killSwitchActive: killSwitchState(),
    dayPnl: activity.realizedPnl,
    tradesTaken: activity.tradesTaken,
    openTrades: activity.openTrades,
    tradeDate: session.date,
    updatedAt: new Date().toISOString(),
    marketOpen: session.marketOpen,
    freshEntriesAllowed: session.freshEntriesAllowed,
    botArmAllowed: session.botArmAllowed,
    squareOffDue: session.squareOffDue,
    sessionPhase: session.phase,
    sessionReason: session.reason,
    sessionDate: session.date,
    closedDay: session.closedDay,
    weekend: session.weekend,
    holiday: session.holiday,
    holidayListStale: session.holidayListStale,
    nextOpenAt: session.nextOpenAt,
    targetAmount: (config.capital * config.targetPct) / 100,
    lossAmount: (config.capital * config.maxLossPct) / 100,
    liveOrderPolicy: "locked-unless-env-enabled",
  };
}

/**
 * Single validator for paper and live orders.
 * mode: "paper" | "live". Live mode adds token/env checks.
 * Overrides (session, killSwitchActive, dayPnl, tradesTaken) exist for tests
 * and for callers that already computed authoritative state this tick.
 */
export function validateOrder(
  order,
  {
    config,
    mode = "paper",
    tokenReady = false,
    liveTradingEnabled = false,
    allowOutsideMarket = false,
    session = null,
    killSwitchActive = null,
    dayPnl = null,
    tradesTaken = null,
  }
) {
  const activeSession = session ?? getMarketSession();
  const activity =
    dayPnl === null || tradesTaken === null ? dailyActivity(activeSession.date, { capital: config.capital }) : null;
  const effectiveDayPnl = dayPnl ?? activity.realizedPnl;
  const effectiveTradesTaken = tradesTaken ?? activity.tradesTaken;
  const effectiveKillSwitch = killSwitchActive ?? killSwitchState();

  const errors = [];
  const quantity = Number(order.quantity ?? 0);
  const price = Number(order.price ?? order.estimatedPrice ?? 0);
  const notional = quantity * price;
  const lossAmount = (config.capital * config.maxLossPct) / 100;
  const isEntry = isEntryOrder(order);

  if (effectiveKillSwitch && isEntry) {
    errors.push("Kill switch is active");
  }
  if (isEntry && !allowOutsideMarket && !activeSession.marketOpen) {
    errors.push("Indian cash market is closed");
  }
  if (isEntry && !allowOutsideMarket && !activeSession.freshEntriesAllowed) {
    errors.push("Fresh entries are not allowed in the current market phase");
  }
  if (mode === "live" && !tokenReady) {
    errors.push("Kite token is missing");
  }
  if (mode === "live" && !liveTradingEnabled) {
    errors.push("LIVE_TRADING_ENABLED is false");
  }
  if (order.exchange !== "NSE") {
    errors.push("Only NSE cash symbols are allowed");
  }
  if ((order.product ?? "MIS") !== "MIS") {
    errors.push("Only MIS intraday product is allowed");
  }
  if (!["BUY", "SELL"].includes(order.transactionType)) {
    errors.push("Transaction type must be BUY or SELL");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    errors.push("Quantity must be positive");
  }
  if (isEntry && Number.isFinite(notional) && notional > config.capital * 0.98) {
    errors.push("Order exceeds daily capital allocation");
  }
  if (isEntry && effectiveTradesTaken >= config.maxTrades) {
    errors.push("Max trades reached");
  }
  if (isEntry && effectiveDayPnl <= -lossAmount) {
    errors.push("Daily loss limit reached");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function validatePaperOrder(order, context) {
  return validateOrder(order, { ...context, mode: "paper" });
}
