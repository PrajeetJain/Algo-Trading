import { appendEvent, readJson, saveJson } from "./database.js";
import { getMarketSession } from "./marketCalendar.js";

const riskStateName = "risk-state.json";

function defaultRiskState(tradeDate = getMarketSession().date, overrides = {}) {
  return {
    killSwitchActive: false,
    dayPnl: 0,
    tradesTaken: 0,
    tradeDate,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function dateKeyInIndia(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return getMarketSession().date;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function loadRiskState() {
  const stored = readJson(riskStateName, {});
  const tradeDate = stored.tradeDate ?? (stored.updatedAt ? dateKeyInIndia(stored.updatedAt) : getMarketSession().date);
  return defaultRiskState(tradeDate, stored);
}

let riskState = loadRiskState();

function ensureRiskStateForSession() {
  const session = getMarketSession();
  if (riskState.tradeDate !== session.date) {
    const previous = riskState;
    riskState = defaultRiskState(session.date, {
      killSwitchActive: previous.killSwitchActive,
    });
    saveJson(riskStateName, riskState);
    appendEvent("risk.daily_reset", {
      from: previous.tradeDate ?? "unknown",
      to: session.date,
      previousDayPnl: previous.dayPnl ?? 0,
      previousTradesTaken: previous.tradesTaken ?? 0,
    });
  }
  return session;
}

function isEntryOrder(order) {
  if (order.intent) {
    return order.intent === "ENTRY";
  }
  return order.transactionType === "BUY";
}

export function getRiskState(config) {
  const session = ensureRiskStateForSession();
  return {
    ...riskState,
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
    nextOpenAt: session.nextOpenAt,
    targetAmount: (config.capital * config.targetPct) / 100,
    lossAmount: (config.capital * config.maxLossPct) / 100,
    liveOrderPolicy: "locked-unless-env-enabled",
  };
}

export function setKillSwitch(active, reason = "manual") {
  ensureRiskStateForSession();
  riskState = {
    ...riskState,
    killSwitchActive: Boolean(active),
    updatedAt: new Date().toISOString(),
  };
  saveJson(riskStateName, riskState);
  appendEvent("risk.kill_switch", { active: riskState.killSwitchActive, reason });
  return riskState;
}

export function recordTradeImpact({ pnl = 0, countTrade = false }) {
  ensureRiskStateForSession();
  riskState = {
    ...riskState,
    dayPnl: riskState.dayPnl + pnl,
    tradesTaken: riskState.tradesTaken + (countTrade ? 1 : 0),
    updatedAt: new Date().toISOString(),
  };
  saveJson(riskStateName, riskState);
  return riskState;
}

export function validateOrder(order, { config, tokenReady, liveTradingEnabled, allowOutsideMarket = false }) {
  const session = ensureRiskStateForSession();
  const errors = [];
  const quantity = Number(order.quantity ?? 0);
  const price = Number(order.price ?? order.estimatedPrice ?? 0);
  const notional = quantity * price;
  const lossAmount = (config.capital * config.maxLossPct) / 100;
  const isEntry = isEntryOrder(order);

  if (riskState.killSwitchActive) {
    errors.push("Kill switch is active");
  }
  if (isEntry && !allowOutsideMarket && !session.marketOpen) {
    errors.push("Indian cash market is closed");
  }
  if (isEntry && !allowOutsideMarket && !session.freshEntriesAllowed) {
    errors.push("Fresh entries are not allowed in the current market phase");
  }
  if (!tokenReady) {
    errors.push("Kite token is missing");
  }
  if (!liveTradingEnabled) {
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
  if (isEntry && riskState.tradesTaken >= config.maxTrades) {
    errors.push("Max trades reached");
  }
  if (isEntry && riskState.dayPnl <= -lossAmount) {
    errors.push("Daily loss limit reached");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function validatePaperOrder(order, { config, allowOutsideMarket = false }) {
  const session = ensureRiskStateForSession();
  const errors = [];
  const quantity = Number(order.quantity ?? 0);
  const price = Number(order.price ?? order.estimatedPrice ?? 0);
  const notional = quantity * price;
  const lossAmount = (config.capital * config.maxLossPct) / 100;
  const isEntry = isEntryOrder(order);

  if (riskState.killSwitchActive) {
    errors.push("Kill switch is active");
  }
  if (isEntry && !allowOutsideMarket && !session.marketOpen) {
    errors.push("Indian cash market is closed");
  }
  if (isEntry && !allowOutsideMarket && !session.freshEntriesAllowed) {
    errors.push("Fresh entries are not allowed in the current market phase");
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
  if (isEntry && riskState.tradesTaken >= config.maxTrades) {
    errors.push("Max trades reached");
  }
  if (isEntry && riskState.dayPnl <= -lossAmount) {
    errors.push("Daily loss limit reached");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
