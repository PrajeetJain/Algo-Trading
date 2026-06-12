import { randomUUID } from "node:crypto";
import { appendEvent } from "./database.js";
import { charges, dailyActivity } from "./ledger.js";
import { getMarketSession } from "./marketCalendar.js";
import { notify } from "./notifier.js";
import { paperOrder } from "./orders.js";
import { killSwitchState } from "./riskGuard.js";
import { strategyProfile } from "./strategy.js";
import {
  closePosition,
  getBotState,
  insertPosition,
  openPositions,
  setBotState,
  updatePositionMarks,
  upsertDayStats,
} from "./positionsStore.js";

const REAL_DATA_SOURCES = new Set(["kite-ws", "kite-rest", "kite-ws-rest-depth"]);
const ENGINE_STATE_KEY = "engine";
const CONFIG_STATE_KEY = "config";
const MAX_SESSION_TRADES = 200;

// See server/index.js defaultConfig for the targetPct/maxLossPct rationale:
// the loss cap leaves room for maxTrades full stop-outs including costs, and
// the target is reachable with one full winner plus a small second win.
export const defaultEngineConfig = {
  capital: 200000,
  targetPct: 0.75,
  maxLossPct: 0.75,
  maxTrades: 2,
  slippageBps: 8,
  minScore: 70,
  minMomentumPct: 0.1,
  maxSpreadBps: 18,
  riskPerTradePct: 0.25,
  stopLossPct: 0.8,
  takeProfitPct: 1.6,
  atrStopMultiplier: 1.5,
  minRelativeStrengthPct: 0.05,
  minNetRewardRisk: 1.2,
  maxVix: 28,
  maxGapPct: 3,
  strategyMode: "hybrid",
};

function freshEngineState(tradeDate) {
  return {
    status: "idle",
    tradeDate,
    startedAt: null,
    closedAt: null,
    lastTickAt: null,
    lastMessage: "Bot is idle.",
    stats: { orders: 0, fills: 0, rejections: 0, slippageCost: 0 },
    sessionTrades: [],
    pnlSeries: [],
    dataStallNotified: false,
  };
}

function slippageFraction(config) {
  return (config.slippageBps ?? 8) / 10000;
}

export function exitFill(position, rawPrice, config) {
  const slippage = slippageFraction(config);
  const exitPrice = position.side === "SHORT" ? rawPrice * (1 + slippage) : rawPrice * (1 - slippage);
  const entryValue = position.entryPrice * position.quantity;
  const exitValue = exitPrice * position.quantity;
  const buyValue = position.side === "SHORT" ? exitValue : entryValue;
  const sellValue = position.side === "SHORT" ? entryValue : exitValue;
  const tradeCharges = charges(buyValue, sellValue);
  const grossPnl = position.side === "SHORT" ? entryValue - exitValue : exitValue - entryValue;
  return {
    exitPrice,
    grossPnl,
    charges: tradeCharges,
    netPnl: grossPnl - tradeCharges,
  };
}

export function estimateUnrealized(position, rawPrice, config) {
  return exitFill(position, rawPrice, config).netPnl;
}

function isExitTriggered(position) {
  if (!position.stopLoss || !position.target) {
    return null;
  }
  if (position.side === "SHORT") {
    if (position.lastPrice >= position.stopLoss) return "stop-loss";
    if (position.lastPrice <= position.target) return "target";
    return null;
  }
  if (position.lastPrice <= position.stopLoss) return "stop-loss";
  if (position.lastPrice >= position.target) return "target";
  return null;
}

/**
 * Pure tick logic: given current state and market inputs, decide exits,
 * entry, price marks, and the next engine status. No I/O — fully testable.
 */
export function applyTick({ status, config, session, killSwitchActive, realizedToday, tradesTaken, positions, strategy, now }) {
  const dataOk = Boolean(strategy) && REAL_DATA_SOURCES.has(strategy.source);
  const priceBySymbol = new Map((strategy?.signals ?? []).map((signal) => [signal.symbol, signal.price]));
  const marks = [];
  const exits = [];
  let entry = null;
  let nextStatus = status;
  let message = strategy?.decision?.reason ?? "";

  const managed = status === "running" || status === "paused";
  if (!managed) {
    return { status, exits, entry, marks, message: "Bot is not running.", dataOk };
  }

  // Mark to market (only with trusted prices), track MFE/MAE per share, and
  // apply per-strategy trade management: breakeven stop once the trade is
  // +breakevenAtR in profit, then a trailing stop locking trailLockRatio of
  // the best excursion once past trailAtR. Stops only ever tighten.
  const marked = positions.map((position) => {
    const rawPrice = dataOk ? priceBySymbol.get(position.symbol) : null;
    if (!rawPrice) {
      return position;
    }
    const directionalMove = position.side === "SHORT" ? position.entryPrice - rawPrice : rawPrice - position.entryPrice;
    let next = {
      ...position,
      lastPrice: rawPrice,
      mfe: Math.max(position.mfe ?? 0, directionalMove),
      mae: Math.max(position.mae ?? 0, -directionalMove),
    };
    const profile = strategyProfile(next.strategy);
    const initialStop = next.initialStop ?? next.stopLoss;
    const riskPerShare = initialStop ? Math.abs(next.entryPrice - initialStop) : 0;
    if (riskPerShare > 0 && next.stopLoss) {
      let newStop = next.stopLoss;
      if (profile.breakevenAtR > 0 && next.mfe >= riskPerShare * profile.breakevenAtR) {
        newStop = next.side === "SHORT" ? Math.min(newStop, next.entryPrice) : Math.max(newStop, next.entryPrice);
      }
      if (profile.trailAtR > 0 && profile.trailLockRatio > 0 && next.mfe >= riskPerShare * profile.trailAtR) {
        const locked = next.mfe * profile.trailLockRatio;
        newStop =
          next.side === "SHORT"
            ? Math.min(newStop, next.entryPrice - locked)
            : Math.max(newStop, next.entryPrice + locked);
      }
      next = { ...next, stopLoss: newStop };
    }
    marks.push({ id: next.id, lastPrice: next.lastPrice, mfe: next.mfe, mae: next.mae, stopLoss: next.stopLoss });
    return next;
  });

  function exitAll(reason) {
    for (const position of marked) {
      if (exits.some((item) => item.position.id === position.id)) {
        continue;
      }
      exits.push({ position, reason, fill: exitFill(position, position.lastPrice, config) });
    }
  }

  const unrealized = marked.reduce((total, position) => total + estimateUnrealized(position, position.lastPrice, config), 0);
  const dayPnl = realizedToday + unrealized;
  const targetAmount = (config.capital * config.targetPct) / 100;
  const lossAmount = (config.capital * config.maxLossPct) / 100;

  if (killSwitchActive) {
    exitAll("kill-switch");
    return { status: "closed", exits, entry, marks, message: "Kill switch active. Positions squared off and bot stopped.", dataOk };
  }

  if (!session.marketOpen && !session.botArmAllowed) {
    exitAll("market-closed");
    return { status: "closed", exits, entry, marks, message: `Market is closed (${session.reason}). Bot stopped.`, dataOk };
  }

  if (marked.length && dayPnl >= targetAmount) {
    exitAll("daily-target");
    return { status: "target-hit", exits, entry, marks, message: "Daily target reached. Paper trading stopped.", dataOk };
  }

  if (marked.length && dayPnl <= -lossAmount) {
    exitAll("daily-loss");
    return { status: "loss-hit", exits, entry, marks, message: "Daily loss limit reached. Paper trading stopped.", dataOk };
  }

  if (session.squareOffDue && marked.length) {
    exitAll("square-off");
    return { status: "closed", exits, entry, marks, message: "Square-off window reached. Positions closed.", dataOk };
  }

  if (dataOk) {
    for (const position of marked) {
      const triggered = isExitTriggered(position);
      if (triggered) {
        exits.push({ position, reason: triggered, fill: exitFill(position, position.lastPrice, config) });
        message = `${position.symbol} exited by ${triggered}.`;
      }
    }
  } else if (marked.length) {
    message = "Live market data unavailable. Holding positions; stops are not being evaluated.";
  }

  const remaining = marked.filter((position) => !exits.some((item) => item.position.id === position.id));

  if (status === "running" && !remaining.length) {
    if (tradesTaken >= config.maxTrades) {
      message = `Daily max trades reached (${tradesTaken}/${config.maxTrades}). No more entries today.`;
    } else if (!session.freshEntriesAllowed) {
      message = session.marketOpen
        ? "Fresh entries are blocked by the market-session guard."
        : "Waiting for market open.";
    } else if (!dataOk) {
      message = "Live market data unavailable. No entries on unverified prices.";
    } else if (strategy.decision.action === "TRADE") {
      const signal = strategy.signals.find((item) => item.symbol === strategy.decision.symbol);
      if (signal?.eligible) {
        const side = strategy.decision.side ?? signal.side ?? "BUY";
        const quantity = strategy.decision.quantity ?? signal.recommendedQuantity ?? 0;
        if (quantity > 0) {
          const slippage = slippageFraction(config);
          const entryPrice = side === "SELL" ? signal.price * (1 - slippage) : signal.price * (1 + slippage);
          entry = {
            id: randomUUID(),
            symbol: signal.symbol,
            side: side === "SELL" ? "SHORT" : "LONG",
            entrySide: side,
            quantity,
            entryPrice,
            rawPrice: signal.price,
            entryAt: now,
            tradeDate: session.date,
            stopLoss: strategy.decision.stopLossPrice ?? signal.stopLossPrice,
            target: strategy.decision.targetPrice ?? signal.targetPrice,
            strategy: signal.strategy,
            score: signal.score,
            lastPrice: signal.price,
            slippageCost: signal.price * slippage * quantity,
          };
          message = `Paper ${entry.side.toLowerCase()} entry: ${entry.symbol} x ${entry.quantity}.`;
        } else {
          message = "Signal passed, but risk sizing returned zero quantity.";
        }
      }
    }
  }

  return { status: nextStatus, exits, entry, marks, message, dataOk };
}

export function createBotEngine({ getStrategy }) {
  let busy = false;
  let lastStrategy = null;

  function loadState() {
    const session = getMarketSession();
    const stored = getBotState(ENGINE_STATE_KEY, null);
    if (!stored) {
      const fresh = freshEngineState(session.date);
      setBotState(ENGINE_STATE_KEY, fresh);
      return fresh;
    }
    return { ...freshEngineState(session.date), ...stored };
  }

  function saveState(state) {
    setBotState(ENGINE_STATE_KEY, state);
  }

  function getConfig() {
    return { ...defaultEngineConfig, ...getBotState(CONFIG_STATE_KEY, {}) };
  }

  function setConfig(config) {
    const merged = { ...defaultEngineConfig, ...getBotState(CONFIG_STATE_KEY, {}), ...config };
    setBotState(CONFIG_STATE_KEY, merged);
    return merged;
  }

  function pushSessionTrade(state, trade) {
    state.sessionTrades = [trade, ...state.sessionTrades].slice(0, MAX_SESSION_TRADES);
  }

  function writeExit(state, exit, session, config) {
    const { position, reason, fill } = exit;
    const transactionType = position.side === "SHORT" ? "BUY" : "SELL";
    const result = paperOrder(
      {
        exchange: "NSE",
        tradingsymbol: position.symbol,
        transactionType,
        quantity: position.quantity,
        product: "MIS",
        orderType: "MARKET",
        price: fill.exitPrice,
        clientOrderId: `bot-exit-${position.id}`,
        intent: "EXIT",
        positionSide: position.side,
        strategy: position.strategy,
        score: position.score,
        stopLossPrice: position.stopLoss ?? 0,
        targetPrice: position.target ?? 0,
      },
      null,
      { config, session, allowOutsideMarket: true, killSwitchActive: false, dayPnl: 0, tradesTaken: 0 }
    );
    closePosition(position.id, {
      exitPrice: fill.exitPrice,
      exitAt: new Date().toISOString(),
      exitReason: reason,
      grossPnl: fill.grossPnl,
      charges: fill.charges,
      netPnl: fill.netPnl,
    });
    state.stats.orders += 1;
    state.stats.fills += 1;
    state.stats.slippageCost += Math.abs(fill.exitPrice - position.lastPrice) * position.quantity;
    pushSessionTrade(state, {
      id: result.orderId ?? randomUUID(),
      time: new Date().toISOString(),
      symbol: position.symbol,
      side: transactionType,
      qty: position.quantity,
      price: fill.exitPrice,
      charges: fill.charges,
      pnl: fill.netPnl,
      status: "EXIT",
      reason,
    });
    appendEvent("bot.exit", { positionId: position.id, symbol: position.symbol, reason, netPnl: fill.netPnl });
    notify("bot.exit", { symbol: position.symbol, reason, netPnl: fill.netPnl });
  }

  function writeEntry(state, entry, session, config, riskContext) {
    const result = paperOrder(
      {
        exchange: "NSE",
        tradingsymbol: entry.symbol,
        transactionType: entry.entrySide,
        quantity: entry.quantity,
        product: "MIS",
        orderType: "MARKET",
        price: entry.entryPrice,
        clientOrderId: `bot-entry-${entry.id}`,
        intent: "ENTRY",
        positionSide: entry.side,
        strategy: entry.strategy,
        score: entry.score,
        stopLossPrice: entry.stopLoss ?? 0,
        targetPrice: entry.target ?? 0,
      },
      null,
      { config, session, killSwitchActive: riskContext.killSwitchActive, dayPnl: riskContext.dayPnl, tradesTaken: riskContext.tradesTaken }
    );
    state.stats.orders += 1;
    if (result.status === "REJECTED") {
      state.stats.rejections += 1;
      pushSessionTrade(state, {
        id: result.orderId ?? randomUUID(),
        time: new Date().toISOString(),
        symbol: entry.symbol,
        side: entry.entrySide,
        qty: 0,
        price: entry.rawPrice,
        charges: 0,
        pnl: 0,
        status: "REJECTED",
        reason: (result.errors ?? []).join(", "),
      });
      return false;
    }
    insertPosition(entry);
    state.stats.fills += 1;
    state.stats.slippageCost += entry.slippageCost;
    pushSessionTrade(state, {
      id: result.orderId ?? randomUUID(),
      time: new Date().toISOString(),
      symbol: entry.symbol,
      side: entry.entrySide,
      qty: entry.quantity,
      price: entry.entryPrice,
      charges: 0,
      pnl: 0,
      status: "ENTRY",
      reason: "",
    });
    appendEvent("bot.entry", { positionId: entry.id, symbol: entry.symbol, side: entry.side, quantity: entry.quantity });
    notify("bot.entry", {
      side: entry.side,
      symbol: entry.symbol,
      quantity: entry.quantity,
      price: entry.entryPrice,
      stopLoss: entry.stopLoss,
      target: entry.target,
    });
    return true;
  }

  function rolloverIfNeeded(state, session, config) {
    if (state.tradeDate === session.date) {
      return state;
    }
    // Stale positions from a previous day mean we crashed before square-off.
    // Close them at the last known price and flag clearly in the ledger.
    for (const position of openPositions()) {
      const fill = exitFill(position, position.lastPrice, config);
      writeExit(state, { position, reason: "stale-recovery", fill }, session, config);
      appendEvent("bot.stale_recovery", { positionId: position.id, symbol: position.symbol, tradeDate: position.tradeDate });
      notify("bot.stale-recovery", { symbol: position.symbol, tradeDate: position.tradeDate });
    }
    const fresh = freshEngineState(session.date);
    saveState(fresh);
    return fresh;
  }

  async function tick() {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const session = getMarketSession();
      const config = getConfig();
      let state = loadState();
      state = rolloverIfNeeded(state, session, config);
      state.lastTickAt = new Date().toISOString();

      const managed = state.status === "running" || state.status === "paused";
      const positions = openPositions();
      if (!managed && !positions.length) {
        saveState(state);
        return;
      }

      let strategy = null;
      try {
        strategy = await getStrategy(config);
        lastStrategy = strategy;
      } catch (error) {
        appendEvent("bot.strategy_error", { message: error instanceof Error ? error.message : "strategy error" });
      }

      const activity = dailyActivity(session.date, { capital: config.capital });
      const killSwitchActive = killSwitchState();
      const result = applyTick({
        status: state.status,
        config,
        session,
        killSwitchActive,
        realizedToday: activity.realizedPnl,
        tradesTaken: activity.tradesTaken,
        positions,
        strategy,
        now: new Date().toISOString(),
      });

      for (const mark of result.marks) {
        updatePositionMarks(mark.id, mark);
      }
      for (const exit of result.exits) {
        writeExit(state, exit, session, config);
      }
      if (result.entry) {
        const unrealizedNow = 0;
        writeEntry(state, result.entry, session, config, {
          killSwitchActive,
          dayPnl: activity.realizedPnl + unrealizedNow,
          tradesTaken: activity.tradesTaken,
        });
      }
      const statusChanged = result.status !== state.status;
      if (statusChanged) {
        state.status = result.status;
        if (["closed", "target-hit", "loss-hit"].includes(result.status)) {
          state.closedAt = new Date().toISOString();
        }
      }
      state.lastMessage = result.message || state.lastMessage;

      // Data-stall alert: fire once per stall, reset when data returns.
      if (!result.dataOk && (state.status === "running" || state.status === "paused") && positions.length) {
        if (!state.dataStallNotified) {
          state.dataStallNotified = true;
          notify("bot.data-stalled", {});
        }
      } else if (result.dataOk) {
        state.dataStallNotified = false;
      }

      // Record the intraday P&L envelope for milestone/give-back analytics
      // and keep a small time series for the dashboard equity sparkline.
      const postActivity = dailyActivity(session.date, { capital: config.capital });
      const postUnrealized = openPositions().reduce(
        (total, position) => total + estimateUnrealized(position, position.lastPrice, config),
        0
      );
      const dayPnlNow = postActivity.realizedPnl + postUnrealized;
      upsertDayStats(session.date, dayPnlNow);
      state.pnlSeries = [...(state.pnlSeries ?? []), { t: new Date().toISOString(), pnl: dayPnlNow }].slice(-400);

      if (statusChanged && ["closed", "target-hit", "loss-hit"].includes(state.status)) {
        if (killSwitchActive) {
          notify("bot.kill-switch", {});
        } else {
          notify("bot.day-locked", { status: state.status, dayPnl: dayPnlNow, tradesTaken: postActivity.tradesTaken });
        }
      }
      saveState(state);
    } finally {
      busy = false;
    }
  }

  function start(configOverride = null) {
    const session = getMarketSession();
    const config = configOverride ? setConfig(configOverride) : getConfig();
    let state = loadState();
    state = rolloverIfNeeded(state, session, config);

    if (killSwitchState()) {
      return { ok: false, error: "Kill switch is active. Release it before starting the bot." };
    }
    const activity = dailyActivity(session.date, { capital: config.capital });
    if (activity.tradesTaken >= config.maxTrades) {
      return { ok: false, error: `Daily max trades reached (${activity.tradesTaken}/${config.maxTrades}).` };
    }
    if (activity.realizedPnl <= -(config.capital * config.maxLossPct) / 100) {
      return { ok: false, error: "Daily loss limit reached. Bot cannot restart today." };
    }
    if (!session.botArmAllowed && !session.marketOpen) {
      return { ok: false, error: `Market is closed (${session.reason}).` };
    }
    state.status = "running";
    state.startedAt = state.startedAt ?? new Date().toISOString();
    state.lastMessage = session.freshEntriesAllowed
      ? "Bot running. Scanning for entries."
      : "Bot armed. Waiting for the entry window.";
    saveState(state);
    appendEvent("bot.start", { tradeDate: state.tradeDate });
    notify("bot.start", {});
    return { ok: true, state: getStateView() };
  }

  function pause() {
    const state = loadState();
    if (state.status === "running") {
      state.status = "paused";
      state.lastMessage = "Bot paused. Open positions are still protected by square-off and kill switch.";
    } else if (state.status === "paused") {
      state.status = "running";
      state.lastMessage = "Bot resumed.";
    } else {
      return { ok: false, error: `Cannot pause/resume from status '${state.status}'.` };
    }
    saveState(state);
    appendEvent("bot.pause_toggle", { status: state.status });
    return { ok: true, state: getStateView() };
  }

  function closeDay() {
    const session = getMarketSession();
    const config = getConfig();
    const state = loadState();
    for (const position of openPositions()) {
      const fill = exitFill(position, position.lastPrice, config);
      writeExit(state, { position, reason: "manual-close", fill }, session, config);
    }
    state.status = "closed";
    state.closedAt = new Date().toISOString();
    state.lastMessage = "Day closed manually. All paper positions squared off.";
    saveState(state);
    appendEvent("bot.close_day", { tradeDate: state.tradeDate });
    return { ok: true, state: getStateView() };
  }

  function getStateView() {
    const session = getMarketSession();
    const config = getConfig();
    let state = loadState();
    state = rolloverIfNeeded(state, session, config);
    const positions = openPositions().map((position) => ({
      ...position,
      currentPnl: estimateUnrealized(position, position.lastPrice, config),
    }));
    const activity = dailyActivity(session.date, { capital: config.capital });
    const unrealizedPnl = positions.reduce((total, position) => total + position.currentPnl, 0);
    return {
      status: state.status,
      tradeDate: state.tradeDate,
      startedAt: state.startedAt,
      closedAt: state.closedAt,
      lastTickAt: state.lastTickAt,
      lastMessage: state.lastMessage,
      config,
      positions,
      sessionTrades: state.sessionTrades,
      stats: state.stats,
      realizedPnl: activity.realizedPnl,
      unrealizedPnl,
      dayPnl: activity.realizedPnl + unrealizedPnl,
      tradesTaken: activity.tradesTaken,
      maxTrades: config.maxTrades,
      dataSource: lastStrategy?.source ?? "unknown",
      pnlSeries: state.pnlSeries ?? [],
      heartbeat: {
        lastTickAt: state.lastTickAt,
        healthy: Boolean(state.lastTickAt) && Date.now() - Date.parse(state.lastTickAt) < 20000,
      },
    };
  }

  return {
    tick,
    start,
    pause,
    closeDay,
    getStateView,
    getConfig,
    setConfig,
  };
}
