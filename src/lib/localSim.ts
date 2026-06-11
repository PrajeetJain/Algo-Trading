import {
  CONFIG_STORAGE_KEY,
  CONFIG_VERSION_STORAGE_KEY,
  LOCAL_RESET_STORAGE_KEY,
  LOCAL_RESET_VERSION,
  PROFIT_MILESTONE_PCTS,
  REPORTS_STORAGE_KEY,
  SAFE_CONFIG_VERSION,
  SIM_STORAGE_KEY,
  defaultConfig,
} from "../types";
import type {
  BackendSignal,
  BotStatus,
  Config,
  DailyReport,
  MilestoneState,
  PaperEngineState,
  Position,
  PositionSide,
  Simulation,
  Stock,
  Trade,
  TradeSide,
  TradeStatus,
} from "../types";
import { clamp, nowLabel, timeLabelFromIso, todayKey } from "./format";

export function createMilestoneState(capital = defaultConfig.capital): MilestoneState {
  return {
    levels: PROFIT_MILESTONE_PCTS.map((pct) => ({
      pct,
      amount: (capital * pct) / 100,
      hit: false,
      hitAt: null,
      pnlAtHit: null,
    })),
    peakPnl: 0,
    peakPct: 0,
    peakAt: null,
    maxDrawdownPnl: 0,
    maxDrawdownPct: 0,
    maxDrawdownAt: null,
  };
}

export function normalizeMilestones(state: Partial<MilestoneState> | undefined, capital: number): MilestoneState {
  const existing = new Map((state?.levels ?? []).map((item) => [item.pct, item]));
  return {
    levels: PROFIT_MILESTONE_PCTS.map((pct) => {
      const stored = existing.get(pct);
      return {
        pct,
        amount: (capital * pct) / 100,
        hit: Boolean(stored?.hit),
        hitAt: stored?.hitAt ?? null,
        pnlAtHit: stored?.pnlAtHit ?? null,
      };
    }),
    peakPnl: Number(state?.peakPnl ?? 0),
    peakPct: Number(state?.peakPct ?? 0),
    peakAt: state?.peakAt ?? null,
    maxDrawdownPnl: Number(state?.maxDrawdownPnl ?? 0),
    maxDrawdownPct: Number(state?.maxDrawdownPct ?? 0),
    maxDrawdownAt: state?.maxDrawdownAt ?? null,
  };
}

export function updateMilestones(state: MilestoneState | undefined, config: Config, dayPnl: number) {
  const next = normalizeMilestones(state, config.capital);
  const now = nowLabel();
  let changed = false;

  if (dayPnl > next.peakPnl) {
    next.peakPnl = dayPnl;
    next.peakPct = config.capital ? (dayPnl / config.capital) * 100 : 0;
    next.peakAt = now;
    changed = true;
  }

  if (dayPnl < next.maxDrawdownPnl) {
    next.maxDrawdownPnl = dayPnl;
    next.maxDrawdownPct = config.capital ? (dayPnl / config.capital) * 100 : 0;
    next.maxDrawdownAt = now;
    changed = true;
  }

  next.levels = next.levels.map((milestone) => {
    const amount = (config.capital * milestone.pct) / 100;
    if (!milestone.hit && dayPnl >= amount) {
      changed = true;
      return {
        ...milestone,
        amount,
        hit: true,
        hitAt: now,
        pnlAtHit: dayPnl,
      };
    }
    return {
      ...milestone,
      amount,
    };
  });

  return {
    milestones: next,
    changed,
  };
}

export function milestoneSummary(milestones: MilestoneState) {
  const hit = milestones.levels.filter((item) => item.hit).map((item) => `${item.pct}%`);
  return hit.length ? hit.join(" | ") : "-";
}

function stock(
  symbol: string,
  name: string,
  sector: string,
  price: number,
  volatility: number,
  spreadBps: number
): Stock {
  const avgVolume = 600000 + Math.floor(Math.random() * 1900000);
  return {
    symbol,
    name,
    sector,
    price,
    prevClose: price * (1 - (Math.random() - 0.4) / 100),
    dayLow: price * 0.992,
    dayHigh: price * 1.008,
    volume: Math.floor(avgVolume * 0.15),
    avgVolume,
    spreadBps,
    volatility,
    momentum: 0,
    score: 50,
  };
}

export const baseStocks: Stock[] = [
  stock("RELIANCE", "Reliance Industries", "Energy", 2872.5, 1.14, 12),
  stock("HDFCBANK", "HDFC Bank", "Banking", 1641.8, 0.82, 8),
  stock("ICICIBANK", "ICICI Bank", "Banking", 1126.45, 1.05, 9),
  stock("INFY", "Infosys", "IT Services", 1478.7, 0.72, 10),
  stock("TCS", "Tata Consultancy", "IT Services", 3916.4, 0.62, 7),
  stock("SBIN", "State Bank of India", "Banking", 827.25, 1.32, 11),
  stock("AXISBANK", "Axis Bank", "Banking", 1178.6, 1.08, 10),
  stock("LT", "Larsen & Toubro", "Infrastructure", 3588.25, 0.9, 8),
  stock("BHARTIARTL", "Bharti Airtel", "Telecom", 1398.1, 0.95, 8),
  stock("MARUTI", "Maruti Suzuki", "Auto", 12442.6, 0.74, 13),
  stock("TITAN", "Titan Company", "Consumer", 3479.3, 1.18, 14),
  stock("ULTRACEMCO", "UltraTech Cement", "Materials", 10924.9, 0.85, 12),
];

export function createInitialSimulation(): Simulation {
  return {
    sessionId: crypto.randomUUID(),
    tradeDate: todayKey(),
    status: "idle",
    stocks: baseStocks.map((item) => ({ ...item })),
    positions: [],
    trades: [],
    realizedPnl: 0,
    tradesTaken: 0,
    startedAt: null,
    closedAt: null,
    ticks: 0,
    stats: {
      orders: 0,
      fills: 0,
      rejections: 0,
      slippageCost: 0,
    },
    milestones: createMilestoneState(),
  };
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function applyLocalResetIfNeeded() {
  if (localStorage.getItem(LOCAL_RESET_STORAGE_KEY) === LOCAL_RESET_VERSION) {
    return;
  }
  localStorage.removeItem(SIM_STORAGE_KEY);
  localStorage.removeItem(REPORTS_STORAGE_KEY);
  localStorage.setItem(LOCAL_RESET_STORAGE_KEY, LOCAL_RESET_VERSION);
}

export function loadConfig() {
  applyLocalResetIfNeeded();
  const stored = readJson<Partial<Config>>(CONFIG_STORAGE_KEY, {});
  const needsSafeProfileMigration = localStorage.getItem(CONFIG_VERSION_STORAGE_KEY) !== SAFE_CONFIG_VERSION;
  if (needsSafeProfileMigration) {
    localStorage.setItem(CONFIG_VERSION_STORAGE_KEY, SAFE_CONFIG_VERSION);
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(defaultConfig));
    return defaultConfig;
  }
  return {
    ...defaultConfig,
    ...stored,
  };
}

export function loadSimulation() {
  const stored = readJson<Partial<Simulation> | null>(SIM_STORAGE_KEY, null);
  if (
    stored?.sessionId &&
    stored.tradeDate === todayKey() &&
    Array.isArray(stored.stocks) &&
    Array.isArray(stored.trades) &&
    Array.isArray(stored.positions)
  ) {
    const restored = {
      ...createInitialSimulation(),
      ...stored,
      positions: stored.positions.map((position) => ({
        ...position,
        side: position.side ?? "LONG",
      })),
      milestones: normalizeMilestones(stored.milestones, defaultConfig.capital),
    } as Simulation;
    return {
      ...restored,
      status: restored.status ?? "idle",
      closedAt: restored.closedAt ?? null,
      stats: {
        ...createInitialSimulation().stats,
        ...restored.stats,
      },
      milestones: normalizeMilestones(restored.milestones, defaultConfig.capital),
    } as Simulation;
  }
  return createInitialSimulation();
}

export function loadReports() {
  return readJson<DailyReport[]>(REPORTS_STORAGE_KEY, []);
}

export function calcCharges(buyValue: number, sellValue: number) {
  const turnover = buyValue + sellValue;
  const buyBrokerage = Math.min(20, buyValue * 0.0003);
  const sellBrokerage = Math.min(20, sellValue * 0.0003);
  const brokerage = buyBrokerage + sellBrokerage;
  const stt = sellValue * 0.00025;
  const exchangeTxn = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = buyValue * 0.00003;
  const gst = (brokerage + exchangeTxn + sebi) * 0.18;
  return brokerage + stt + exchangeTxn + sebi + stamp + gst;
}

export function calcPositionSizing(price: number, config: Config, atr = 0, side: TradeSide = "BUY") {
  const riskAmount = (config.capital * config.riskPerTradePct) / 100;
  const percentStopDistance = price * (config.stopLossPct / 100);
  const atrStopDistance = atr ? atr * config.atrStopMultiplier : 0;
  const stopDistance = Math.max(percentStopDistance, atrStopDistance, price * 0.004);
  const capitalCapQuantity = Math.floor((config.capital * 0.96) / price);
  const riskQuantity = Math.floor(riskAmount / stopDistance);
  const quantity = Math.max(0, Math.min(capitalCapQuantity, riskQuantity));
  const targetDistance = Math.max(price * (config.takeProfitPct / 100), stopDistance * 1.4);
  return {
    quantity,
    stopDistance,
    stopLossPrice: side === "SELL" ? price + stopDistance : price - stopDistance,
    targetPrice: side === "SELL" ? price - targetDistance : price + targetDistance,
    positionRisk: quantity * stopDistance,
  };
}

function calcScore(item: Stock) {
  const volumePulse = clamp((item.volume / item.avgVolume - 0.12) * 90, 0, 28);
  const momentumScore = clamp(item.momentum * 10 + 18, 0, 36);
  const liquidityScore = clamp(26 - item.spreadBps * 0.9, 0, 26);
  const trendScore = item.price > item.prevClose ? 10 : 2;
  return clamp(Math.round(momentumScore + volumePulse + liquidityScore + trendScore), 0, 100);
}

export function advanceMarket(stocks: Stock[], running: boolean) {
  return stocks.map((item) => {
    const volumePulse = running ? 0.002 + Math.random() * 0.007 : 0.001 + Math.random() * 0.002;
    const drift = item.momentum * 0.015;
    const shock = (Math.random() - 0.47) * item.volatility * (running ? 0.22 : 0.08);
    const nextPrice = Math.max(10, item.price * (1 + (drift + shock) / 100));
    const nextVolume = item.volume + Math.floor(item.avgVolume * volumePulse);
    const momentum = ((nextPrice - item.prevClose) / item.prevClose) * 100;
    const spreadBps = clamp(item.spreadBps + (Math.random() - 0.5) * 1.8, 3, 24);
    const updated = {
      ...item,
      price: nextPrice,
      dayLow: Math.min(item.dayLow, nextPrice),
      dayHigh: Math.max(item.dayHigh, nextPrice),
      volume: nextVolume,
      momentum,
      spreadBps,
    };
    return {
      ...updated,
      score: calcScore(updated),
    };
  });
}

export function estimatePositionPnl(position: Position, stocks: Stock[], config: Config) {
  const live = stocks.find((item) => item.symbol === position.symbol);
  const lastPrice = live?.price ?? position.lastPrice;
  const exitPrice = getExitPrice(lastPrice, position.side, config);
  const grossPnl =
    position.side === "SHORT"
      ? (position.entryPrice - exitPrice) * position.qty
      : (exitPrice - position.entryPrice) * position.qty;
  const buyValue = (position.side === "SHORT" ? exitPrice : position.entryPrice) * position.qty;
  const sellValue = (position.side === "SHORT" ? position.entryPrice : exitPrice) * position.qty;
  return grossPnl - calcCharges(buyValue, sellValue);
}

export function positionSideFromEntry(side: TradeSide): PositionSide {
  return side === "SELL" ? "SHORT" : "LONG";
}

export function entrySideFromPositionSide(side: PositionSide): TradeSide {
  return side === "SHORT" ? "SELL" : "BUY";
}

export function exitSideForPosition(position: Position): TradeSide {
  return position.side === "SHORT" ? "BUY" : "SELL";
}

export function getEntryPrice(price: number, side: TradeSide, config: Config) {
  const slippage = config.slippageBps / 10000;
  return side === "SELL" ? price * (1 - slippage) : price * (1 + slippage);
}

export function getExitPrice(price: number, side: PositionSide, config: Config) {
  const slippage = config.slippageBps / 10000;
  return side === "SHORT" ? price * (1 + slippage) : price * (1 - slippage);
}

export function isPositionExitTriggered(position: Position) {
  return position.side === "SHORT"
    ? position.lastPrice >= position.stopLoss || position.lastPrice <= position.targetPrice
    : position.lastPrice <= position.stopLoss || position.lastPrice >= position.targetPrice;
}

export function closePosition(position: Position, stocks: Stock[], config: Config, reason: TradeStatus = "EXIT") {
  const live = stocks.find((item) => item.symbol === position.symbol);
  const lastPrice = live?.price ?? position.lastPrice;
  const exitPrice = getExitPrice(lastPrice, position.side, config);
  const buyValue = (position.side === "SHORT" ? exitPrice : position.entryPrice) * position.qty;
  const sellValue = (position.side === "SHORT" ? position.entryPrice : exitPrice) * position.qty;
  const charges = calcCharges(buyValue, sellValue);
  const pnl =
    position.side === "SHORT"
      ? (position.entryPrice - exitPrice) * position.qty - charges
      : (exitPrice - position.entryPrice) * position.qty - charges;
  return {
    trade: {
      id: crypto.randomUUID(),
      time: nowLabel(),
      symbol: position.symbol,
      side: exitSideForPosition(position),
      qty: position.qty,
      price: exitPrice,
      charges,
      pnl,
      status: reason,
    },
    pnl,
  };
}

export function applyMilestonesToSimulation(sim: Simulation, config: Config, observedPnls: number[] = []) {
  const unrealizedPnl = sim.positions.reduce(
    (total, position) => total + estimatePositionPnl(position, sim.stocks, config),
    0
  );
  let milestones = normalizeMilestones(sim.milestones, config.capital);
  for (const pnl of [...observedPnls, sim.realizedPnl + unrealizedPnl]) {
    milestones = updateMilestones(milestones, config, pnl).milestones;
  }
  return {
    ...sim,
    milestones,
  };
}

export function buildDailyReport(sim: Simulation, config: Config, dayPnl: number): DailyReport {
  const charges = sim.trades.reduce((total, trade) => total + trade.charges, 0);
  const milestones = normalizeMilestones(sim.milestones, config.capital);
  return {
    id: sim.sessionId,
    date: sim.tradeDate,
    startedAt: sim.startedAt ?? "-",
    closedAt: sim.closedAt ?? nowLabel(),
    status: sim.status,
    capital: config.capital,
    targetAmount: (config.capital * config.targetPct) / 100,
    lossAmount: (config.capital * config.maxLossPct) / 100,
    netPnl: dayPnl,
    tradesTaken: sim.tradesTaken,
    fills: sim.stats.fills,
    rejections: sim.stats.rejections,
    charges,
    slippageCost: sim.stats.slippageCost,
    peakPnl: milestones.peakPnl,
    peakPct: milestones.peakPct,
    maxDrawdownPnl: milestones.maxDrawdownPnl,
    maxDrawdownPct: milestones.maxDrawdownPct,
    milestonesHit: milestoneSummary(milestones),
    gaveBackFromPeak: Math.max(0, milestones.peakPnl - dayPnl),
  };
}

export function applyBackendSignals(stocks: Stock[], signals: BackendSignal[]) {
  const bySymbol = new Map(signals.map((signal) => [signal.symbol, signal]));
  return stocks.map((item) => {
    const signal = bySymbol.get(item.symbol);
    if (!signal) {
      return item;
    }
    return {
      ...item,
      price: signal.price,
      dayLow: Math.min(item.dayLow, signal.price),
      dayHigh: Math.max(item.dayHigh, signal.price),
      volume: signal.volume,
      avgVolume: Math.max(item.avgVolume, signal.volume),
      spreadBps: signal.spreadBps,
      momentum: signal.momentumPct,
      score: signal.score,
    };
  });
}

export function scannerRowsFromSignals(signals: BackendSignal[]) {
  return signals.map((signal) => ({
    symbol: signal.symbol,
    sector: signal.sector,
    price: signal.price,
    changePct: signal.momentumPct,
    score: signal.score,
    volume: signal.volume ?? 0,
    spreadBps: signal.spreadBps,
    source: signal.source,
    eligible: signal.eligible,
    side: signal.side,
  }));
}

export function scannerRowsFromStocks(stocks: Stock[]) {
  return stocks.map((item) => ({
    symbol: item.symbol,
    sector: item.sector,
    price: item.price,
    changePct: ((item.price - item.prevClose) / item.prevClose) * 100,
    score: item.score,
    volume: item.volume,
    spreadBps: item.spreadBps,
    source: "local-sim",
    eligible: false,
    side: (item.momentum < 0 ? "SELL" : "BUY") as TradeSide,
  }));
}

// The backend bot engine is the source of truth when the API is online.
// This maps its state into the local Simulation shape the dashboard renders.
export function simFromEngine(current: Simulation, engine: PaperEngineState, config: Config): Simulation {
  const positions: Position[] = engine.positions.map((position) => ({
    id: position.id,
    symbol: position.symbol,
    side: position.side,
    qty: position.quantity,
    entryPrice: position.entryPrice,
    lastPrice: position.lastPrice,
    stopLoss: position.stopLoss ?? 0,
    targetPrice: position.target ?? 0,
    openedAt: timeLabelFromIso(position.entryAt),
    strategy: position.strategy,
    score: position.score,
  }));
  const trades: Trade[] = engine.sessionTrades.map((trade) => ({
    id: trade.id,
    time: timeLabelFromIso(trade.time),
    symbol: trade.symbol,
    side: trade.side,
    qty: trade.qty,
    price: trade.price,
    charges: trade.charges,
    pnl: trade.pnl,
    status: trade.status,
  }));
  return applyMilestonesToSimulation(
    {
      ...current,
      tradeDate: engine.tradeDate,
      status: engine.status,
      positions,
      trades,
      realizedPnl: engine.realizedPnl,
      tradesTaken: engine.tradesTaken,
      startedAt: engine.startedAt ? timeLabelFromIso(engine.startedAt) : current.startedAt,
      closedAt: engine.closedAt ? timeLabelFromIso(engine.closedAt) : null,
      stats: { ...engine.stats },
    },
    config,
    [engine.dayPnl]
  );
}

export function tickSimulation(sim: Simulation, config: Config): Simulation {
  const stocks = advanceMarket(sim.stocks, sim.status === "running");

  if (sim.status !== "running") {
    return applyMilestonesToSimulation(
      {
        ...sim,
        stocks,
        ticks: sim.ticks + 1,
      },
      config
    );
  }

  let positions = sim.positions.map((position) => {
    const live = stocks.find((item) => item.symbol === position.symbol);
    return {
      ...position,
      lastPrice: live?.price ?? position.lastPrice,
    };
  });
  let realizedPnl = sim.realizedPnl;
  let trades = [...sim.trades];
  let tradesTaken = sim.tradesTaken;
  let stats = { ...sim.stats };
  let status: BotStatus = sim.status;
  const targetAmount = (config.capital * config.targetPct) / 100;
  const lossAmount = (config.capital * config.maxLossPct) / 100;
  const unrealizedPnl = positions.reduce(
    (total, position) => total + estimatePositionPnl(position, stocks, config),
    0
  );
  const dayPnl = realizedPnl + unrealizedPnl;

  if (positions.length && (dayPnl >= targetAmount || dayPnl <= -lossAmount)) {
    const exits = positions.map((position) => closePosition(position, stocks, config));
    trades = [...exits.map((exit) => exit.trade), ...trades];
    realizedPnl += exits.reduce((total, exit) => total + exit.pnl, 0);
    stats.fills += exits.length;
    stats.orders += exits.length;
    positions = [];
    status = dayPnl >= targetAmount ? "target-hit" : "loss-hit";
    return applyMilestonesToSimulation(
      {
        ...sim,
        stocks,
        positions,
        trades,
        realizedPnl,
        tradesTaken,
        stats,
        status,
        closedAt: nowLabel(),
        ticks: sim.ticks + 1,
      },
      config,
      [dayPnl]
    );
  }

  const stopTriggered = positions.find((position) => isPositionExitTriggered(position));

  if (stopTriggered) {
    const exit = closePosition(stopTriggered, stocks, config);
    trades = [exit.trade, ...trades];
    realizedPnl += exit.pnl;
    stats.fills += 1;
    stats.orders += 1;
    positions = positions.filter((position) => position.id !== stopTriggered.id);
  }

  if (realizedPnl >= targetAmount) {
    status = "target-hit";
  }

  if (realizedPnl <= -lossAmount) {
    status = "loss-hit";
  }

  if (status === "running" && !positions.length && tradesTaken < config.maxTrades) {
    const candidate = [...stocks]
      .map((item) => {
        const entrySide: TradeSide = item.momentum < 0 ? "SELL" : "BUY";
        const directionalMomentum = entrySide === "SELL" ? -item.momentum : item.momentum;
        const liquidityScore = clamp(26 - item.spreadBps * 0.9, 0, 26);
        const directionScore =
          entrySide === "SELL"
            ? Math.round(clamp(directionalMomentum * 12 + liquidityScore + 24, 0, 100))
            : item.score;
        return {
          item,
          entrySide,
          directionScore,
          directionalMomentum,
        };
      })
      .filter(
        ({ item, directionScore, directionalMomentum }) =>
          item.price <= config.capital * 0.98 &&
          directionScore >= config.minScore &&
          directionalMomentum >= config.minMomentumPct &&
          item.spreadBps <= config.maxSpreadBps
      )
      .sort((a, b) => b.directionScore - a.directionScore)[0];

    if (candidate) {
      const { item, entrySide } = candidate;
      const positionSide = positionSideFromEntry(entrySide);
      stats.orders += 1;
      const shouldReject = Math.random() < 0.06 || item.spreadBps > 20;
      if (shouldReject) {
        stats.rejections += 1;
        trades = [
          {
            id: crypto.randomUUID(),
            time: nowLabel(),
            symbol: item.symbol,
            side: entrySide,
            qty: 0,
            price: item.price,
            charges: 0,
            pnl: 0,
            status: "REJECTED",
          },
          ...trades,
        ];
      } else {
        const entryPrice = getEntryPrice(item.price, entrySide, config);
        const sizing = calcPositionSizing(entryPrice, config, 0, entrySide);
        const qty = sizing.quantity;
        if (qty <= 0) {
          stats.rejections += 1;
          trades = [
            {
              id: crypto.randomUUID(),
              time: nowLabel(),
              symbol: item.symbol,
              side: entrySide,
              qty: 0,
              price: item.price,
              charges: 0,
              pnl: 0,
              status: "REJECTED",
            },
            ...trades,
          ];
          return applyMilestonesToSimulation(
            {
              ...sim,
              stocks,
              positions,
              trades,
              realizedPnl,
              tradesTaken,
              stats,
              status,
              ticks: sim.ticks + 1,
            },
            config,
            [dayPnl]
          );
        }
        const slippageCost = item.price * (config.slippageBps / 10000) * qty;
        const position: Position = {
          id: crypto.randomUUID(),
          symbol: item.symbol,
          side: positionSide,
          qty,
          entryPrice,
          lastPrice: item.price,
          stopLoss: sizing.stopLossPrice,
          targetPrice: sizing.targetPrice,
          openedAt: nowLabel(),
          strategy: "hybrid",
          score: candidate.directionScore,
        };
        positions = [position];
        tradesTaken += 1;
        stats.fills += 1;
        stats.slippageCost += slippageCost;
        trades = [
          {
            id: crypto.randomUUID(),
            time: position.openedAt,
            symbol: item.symbol,
            side: entrySide,
            qty,
            price: entryPrice,
            charges: 0,
            pnl: 0,
            status: "ENTRY",
          },
          ...trades,
        ];
      }
    }
  }

  return applyMilestonesToSimulation(
    {
      ...sim,
      stocks,
      positions,
      trades,
      realizedPnl,
      tradesTaken,
      stats,
      status,
      ticks: sim.ticks + 1,
    },
    config,
    [dayPnl]
  );
}
