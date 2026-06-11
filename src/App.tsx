import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  CircleDollarSign,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileClock,
  KeyRound,
  Moon,
  Pause,
  Play,
  PlugZap,
  Radio,
  RefreshCw,
  ShieldCheck,
  Square,
  Sun,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Theme = "light" | "dark";
type BotStatus = "idle" | "running" | "paused" | "target-hit" | "loss-hit" | "closed";
type TradeStatus = "ENTRY" | "EXIT" | "REJECTED";
type TradeSide = "BUY" | "SELL";
type PositionSide = "LONG" | "SHORT";
type OrderIntent = "ENTRY" | "EXIT";

type Stock = {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  prevClose: number;
  dayLow: number;
  dayHigh: number;
  volume: number;
  avgVolume: number;
  spreadBps: number;
  volatility: number;
  momentum: number;
  score: number;
};

type Position = {
  id: string;
  symbol: string;
  side: PositionSide;
  qty: number;
  entryPrice: number;
  lastPrice: number;
  stopLoss: number;
  targetPrice: number;
  openedAt: string;
  strategy?: Config["strategyMode"];
  score?: number;
};

type Trade = {
  id: string;
  time: string;
  symbol: string;
  side: TradeSide;
  qty: number;
  price: number;
  charges: number;
  pnl: number;
  status: TradeStatus;
};

type Config = {
  capital: number;
  targetPct: number;
  maxLossPct: number;
  maxTrades: number;
  slippageBps: number;
  minScore: number;
  minMomentumPct: number;
  maxSpreadBps: number;
  riskPerTradePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  atrStopMultiplier: number;
  minRelativeStrengthPct: number;
  minNetRewardRisk: number;
  strategyMode: "hybrid" | "momentum" | "mean-reversion" | "vwap-pullback" | "opening-range";
};

type ExecutionStats = {
  orders: number;
  fills: number;
  rejections: number;
  slippageCost: number;
};

type ProfitMilestone = {
  pct: number;
  amount: number;
  hit: boolean;
  hitAt: string | null;
  pnlAtHit: number | null;
};

type MilestoneState = {
  levels: ProfitMilestone[];
  peakPnl: number;
  peakPct: number;
  peakAt: string | null;
  maxDrawdownPnl: number;
  maxDrawdownPct: number;
  maxDrawdownAt: string | null;
};

type Simulation = {
  sessionId: string;
  tradeDate: string;
  status: BotStatus;
  stocks: Stock[];
  positions: Position[];
  trades: Trade[];
  realizedPnl: number;
  tradesTaken: number;
  startedAt: string | null;
  closedAt: string | null;
  ticks: number;
  stats: ExecutionStats;
  milestones: MilestoneState;
};

type DailyReport = {
  id: string;
  date: string;
  startedAt: string;
  closedAt: string;
  status: BotStatus;
  capital: number;
  targetAmount: number;
  lossAmount: number;
  netPnl: number;
  tradesTaken: number;
  fills: number;
  rejections: number;
  charges: number;
  slippageCost: number;
  peakPnl: number;
  peakPct: number;
  maxDrawdownPnl: number;
  maxDrawdownPct: number;
  milestonesHit: string;
  gaveBackFromPeak: number;
};

type BrokerStatus = {
  broker: string;
  mode: "paper" | "live";
  apiConfigured: boolean;
  liveTradingEnabled: boolean;
  tokenState: "ready" | "missing";
  dataSource: "simulator" | "kite-rest" | "kite-ws";
  orderRoute: "simulator" | "kite";
  liveOrders: "armed" | "locked";
  serverTime: string;
  profile: {
    userId: string;
    userName: string;
    email: string;
    broker: string;
  } | null;
  stream?: {
    state: string;
    subscribed: number;
    tickCount: number;
    lastTickAt: string | null;
    stale: boolean;
    source: string;
  };
  rateLimits?: Record<string, { calls: number; delayed: number; minIntervalMs: number; lastRunAt: string | null }>;
};

type BackendSignal = {
  symbol: string;
  name: string;
  sector: string;
  source: string;
  price: number;
  score: number;
  strategyScore?: number;
  eligible: boolean;
  gateReasons?: string[];
  confidence: number;
  momentumPct: number;
  relativeStrengthPct: number;
  niftyBiasPct: number;
  marketRegime?: MarketRegime | null;
  spreadBps: number;
  volume: number;
  volumePulse?: number;
  atr?: number;
  vwap?: number;
  strategy: Config["strategyMode"];
  setup: string;
  stopLossPrice: number;
  targetPrice: number;
  positionRisk: number;
  riskReward: number;
  netRewardRisk: number;
  netReward: number;
  estimatedCharges: number;
  recommendedQuantity: number;
  side: TradeSide;
  reasons: string[];
};

type MarketRegime = {
  state: string;
  bias: "bullish" | "bearish" | "neutral";
  trendPct: number;
  volatility: string;
  atrPct: number;
  label: string;
};

type StrategyPayload = {
  source: "simulator" | "kite-rest" | "kite-ws" | "kite-ws-rest-depth";
  generatedAt: string;
  marketRegime?: MarketRegime | null;
  decision: {
    action: "WAIT" | "TRADE";
    symbol?: string;
    side?: TradeSide;
    quantity?: number;
    stopLossPrice?: number;
    targetPrice?: number;
    riskAmount?: number;
    strategy?: Config["strategyMode"];
    score?: number;
    confidence: number;
    reason: string;
  };
  signals: BackendSignal[];
};

type RiskState = {
  killSwitchActive: boolean;
  dayPnl: number;
  tradesTaken: number;
  marketOpen: boolean;
  freshEntriesAllowed: boolean;
  botArmAllowed: boolean;
  squareOffDue: boolean;
  sessionPhase: string;
  sessionReason: string;
  sessionDate: string;
  closedDay: boolean;
  weekend: boolean;
  holiday: boolean;
  nextOpenAt: string | null;
  targetAmount: number;
  lossAmount: number;
  liveOrderPolicy: string;
};

type BacktestResult = {
  id: string;
  createdAt: string;
  source: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  maxDrawdown: number;
  expectancy: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  totalCharges: number;
  maxConsecutiveLosses: number;
};

type TradePerformanceRow = {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  avgWin: number;
  avgLoss: number;
  winRate: number;
  profitFactor: number;
};

type SignalQualityRow = {
  key: string;
  samples: number;
  eligible: number;
  tradeDecisions: number;
  eligibleRate: number;
  avgScore: number;
  avgRelativeStrength: number;
  avgNetRewardRisk: number;
};

type RegimeQualityRow = {
  key: string;
  snapshots: number;
  tradeDecisions: number;
  eligibleSignals: number;
  totalSignals: number;
  eligibleRate: number;
};

type RecentSignalRow = {
  id: string;
  createdAt: string;
  symbol: string;
  side: TradeSide;
  strategy: Config["strategyMode"];
  score: number;
  eligible: boolean;
  relativeStrengthPct: number;
  netRewardRisk: number;
  regime: string;
  gateReasons: string[];
};

type AnalyticsPayload = {
  generatedAt: string;
  capital: number;
  totals: {
    closedTrades: number;
    netPnl: number;
    winRate: number;
    charges: number;
    signalSnapshots: number;
    totalSignals: number;
    eligibleSignals: number;
    eligibleRate: number;
    tradeDecisions: number;
    waitDecisions: number;
  };
  tradePerformance: {
    byStrategy: TradePerformanceRow[];
    bySymbol: TradePerformanceRow[];
    bySide: TradePerformanceRow[];
  };
  signalQuality: {
    byStrategy: SignalQualityRow[];
    bySymbol: SignalQualityRow[];
    bySide: SignalQualityRow[];
    byRegime: RegimeQualityRow[];
    recent: RecentSignalRow[];
  };
};

type PaperOrderRequest = {
  exchange: "NSE";
  tradingsymbol: string;
  transactionType: TradeSide;
  quantity: number;
  product: "MIS";
  orderType: "MARKET";
  price: number;
  clientOrderId: string;
  intent: OrderIntent;
  positionSide: PositionSide;
  pnl?: number;
  strategy?: Config["strategyMode"];
  score?: number;
  stopLossPrice?: number;
  targetPrice?: number;
};

type HistoryTrade = {
  id: string;
  date: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryAt: string;
  exitAt: string | null;
  entryPrice: number;
  exitPrice: number | null;
  buyValue: number;
  sellValue: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  netPct: number;
  capitalPct: number;
  strategy?: Config["strategyMode"] | "unknown";
  entryScore?: number;
  exitScore?: number;
  stopLossPrice?: number | null;
  targetPrice?: number | null;
  mode: "paper" | "live";
  status: "CLOSED" | "OPEN";
};

type DailyTradeSummary = {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  netPct: number;
};

type TradeHistoryPayload = {
  generatedAt: string;
  capital: number;
  trades: HistoryTrade[];
  daily: DailyTradeSummary[];
  totals: {
    closedTrades: number;
    openTrades: number;
    rejectedOrders: number;
    wins: number;
    losses: number;
    grossPnl: number;
    charges: number;
    netPnl: number;
    netPct: number;
    winRate: number;
  };
};

const MARKET_OPEN = "09:15";
const MARKET_CLOSE = "15:30";
const CONFIG_STORAGE_KEY = "aindra-config";
const CONFIG_VERSION_STORAGE_KEY = "aindra-config-version";
const SIM_STORAGE_KEY = "aindra-current-session";
const REPORTS_STORAGE_KEY = "aindra-daily-reports";
const LOCAL_RESET_STORAGE_KEY = "aindra-local-reset-version";
const LOCAL_RESET_VERSION = "2026-06-09-clean-50k-v1";
const SAFE_CONFIG_VERSION = "3";
const PROFIT_MILESTONE_PCTS = [0.25, 0.5, 0.75, 1];

const defaultConfig: Config = {
  capital: 50000,
  targetPct: 1,
  maxLossPct: 0.5,
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
  strategyMode: "hybrid",
};

function createMilestoneState(capital = defaultConfig.capital): MilestoneState {
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

function normalizeMilestones(state: Partial<MilestoneState> | undefined, capital: number): MilestoneState {
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

function updateMilestones(state: MilestoneState | undefined, config: Config, dayPnl: number) {
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

function milestoneSummary(milestones: MilestoneState) {
  const hit = milestones.levels.filter((item) => item.hit).map((item) => `${item.pct}%`);
  return hit.length ? hit.join(" | ") : "-";
}

const baseStocks: Stock[] = [
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

function createInitialSimulation(): Simulation {
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

function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

function readJson<T>(key: string, fallback: T): T {
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

function loadConfig() {
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

function loadSimulation() {
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

function loadReports() {
  return readJson<DailyReport[]>(REPORTS_STORAGE_KEY, []);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCurrency(value: number, maxFractionDigits = 0) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(Math.round(value));
}

function formatPercent(value: number, digits = 2) {
  return `${Number.isFinite(value) ? value.toFixed(digits) : "0.00"}%`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    "kite-ws": "Kite WS",
    "kite-ws-rest-depth": "Kite WS+REST",
    "kite-rest": "Kite REST",
    simulator: "simulator",
    "local-sim": "local-sim",
  };
  return labels[source] ?? source;
}

function strategyLabel(mode: Config["strategyMode"] | string | undefined) {
  const labels: Record<string, string> = {
    hybrid: "Hybrid",
    momentum: "Momentum",
    "mean-reversion": "Mean Rev",
    "vwap-pullback": "VWAP Pullback",
    "opening-range": "Opening Range",
  };
  return labels[mode ?? ""] ?? "Hybrid";
}

function formatNextOpen(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nowLabel() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function calcCharges(buyValue: number, sellValue: number) {
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

function calcPositionSizing(price: number, config: Config, atr = 0, side: TradeSide = "BUY") {
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

function advanceMarket(stocks: Stock[], running: boolean) {
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

function estimatePositionPnl(position: Position, stocks: Stock[], config: Config) {
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

function positionSideFromEntry(side: TradeSide): PositionSide {
  return side === "SELL" ? "SHORT" : "LONG";
}

function entrySideFromPositionSide(side: PositionSide): TradeSide {
  return side === "SHORT" ? "SELL" : "BUY";
}

function exitSideForPosition(position: Position): TradeSide {
  return position.side === "SHORT" ? "BUY" : "SELL";
}

function getEntryPrice(price: number, side: TradeSide, config: Config) {
  const slippage = config.slippageBps / 10000;
  return side === "SELL" ? price * (1 - slippage) : price * (1 + slippage);
}

function getExitPrice(price: number, side: PositionSide, config: Config) {
  const slippage = config.slippageBps / 10000;
  return side === "SHORT" ? price * (1 + slippage) : price * (1 - slippage);
}

function isPositionExitTriggered(position: Position) {
  return position.side === "SHORT"
    ? position.lastPrice >= position.stopLoss || position.lastPrice <= position.targetPrice
    : position.lastPrice <= position.stopLoss || position.lastPrice >= position.targetPrice;
}

function closePosition(position: Position, stocks: Stock[], config: Config, reason: TradeStatus = "EXIT") {
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

function applyMilestonesToSimulation(sim: Simulation, config: Config, observedPnls: number[] = []) {
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

function buildDailyReport(sim: Simulation, config: Config, dayPnl: number): DailyReport {
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

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}

function toCsv(rows: Array<Record<string, string | number>>) {
  if (!rows.length) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","));
  return [headers.join(","), ...body].join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function configQuery(config: Config) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(config)) {
    params.set(key, String(value));
  }
  return params.toString();
}

function applyBackendSignals(stocks: Stock[], signals: BackendSignal[]) {
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

function buildPaperOrder(
  transactionType: TradeSide,
  symbol: string,
  quantity: number,
  price: number,
  pnl = 0,
  intent: OrderIntent = "ENTRY",
  positionSide: PositionSide = positionSideFromEntry(transactionType),
  strategy: Config["strategyMode"] = "hybrid",
  score = 0,
  stopLossPrice = 0,
  targetPrice = 0
): PaperOrderRequest {
  return {
    exchange: "NSE",
    tradingsymbol: symbol,
    transactionType,
    quantity,
    product: "MIS",
    orderType: "MARKET",
    price,
    clientOrderId: `${transactionType}-${symbol}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    intent,
    positionSide,
    pnl,
    strategy,
    score,
    stopLossPrice,
    targetPrice,
  };
}

function buildExitPaperOrder(position: Position, exit: { trade: Trade; pnl: number }) {
  return buildPaperOrder(
    exit.trade.side,
    position.symbol,
    position.qty,
    exit.trade.price,
    exit.pnl,
    "EXIT",
    position.side,
    position.strategy,
    position.score,
    position.stopLoss,
    position.targetPrice
  );
}

function scannerRowsFromSignals(signals: BackendSignal[]) {
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

function scannerRowsFromStocks(stocks: Stock[]) {
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
    side: item.momentum < 0 ? "SELL" : "BUY",
  }));
}

function timeLabelFromIso(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function restorePositionsFromOpenTrades(
  openTrades: HistoryTrade[],
  signals: BackendSignal[],
  stocks: Stock[],
  config: Config
): Position[] {
  return openTrades.map((trade) => {
    const signal = signals.find((item) => item.symbol === trade.symbol);
    const stock = stocks.find((item) => item.symbol === trade.symbol);
    const entrySide = entrySideFromPositionSide(trade.side);
    const fallbackSizing = calcPositionSizing(trade.entryPrice, config, signal?.atr ?? 0, entrySide);
    return {
      id: `restored-${trade.id}`,
      symbol: trade.symbol,
      side: trade.side,
      qty: trade.quantity,
      entryPrice: trade.entryPrice,
      lastPrice: signal?.price ?? stock?.price ?? trade.entryPrice,
      stopLoss: trade.stopLossPrice || fallbackSizing.stopLossPrice,
      targetPrice: trade.targetPrice || fallbackSizing.targetPrice,
      openedAt: timeLabelFromIso(trade.entryAt),
      strategy: trade.strategy && trade.strategy !== "unknown" ? trade.strategy : "hybrid",
      score: trade.entryScore ?? signal?.score ?? 0,
    };
  });
}

function entryTradesFromOpenHistory(openTrades: HistoryTrade[]): Trade[] {
  return openTrades.map((trade) => ({
    id: `restored-entry-${trade.id}`,
    time: timeLabelFromIso(trade.entryAt),
    symbol: trade.symbol,
    side: entrySideFromPositionSide(trade.side),
    qty: trade.quantity,
    price: trade.entryPrice,
    charges: 0,
    pnl: 0,
    status: "ENTRY",
  }));
}

function tickBackendPaper(
  sim: Simulation,
  config: Config,
  strategy: StrategyPayload,
  risk: RiskState | null
): { next: Simulation; orders: PaperOrderRequest[]; message: string } {
  const stocks = applyBackendSignals(sim.stocks, strategy.signals);
  const orders: PaperOrderRequest[] = [];

  if (sim.status !== "running") {
    return {
      next: applyMilestonesToSimulation({
        ...sim,
        stocks,
        ticks: sim.ticks + 1,
      }, config),
      orders,
      message: strategy.decision.reason,
    };
  }

  if (risk && !risk.botArmAllowed && !risk.marketOpen) {
    const exits = sim.positions.map((position) => closePosition(position, stocks, config));
    return {
      next: applyMilestonesToSimulation({
        ...sim,
        stocks,
        positions: [],
        trades: [...exits.map((exit) => exit.trade), ...sim.trades],
        realizedPnl: sim.realizedPnl + exits.reduce((total, exit) => total + exit.pnl, 0),
        status: "closed",
        closedAt: nowLabel(),
        stats: {
          ...sim.stats,
          orders: sim.stats.orders + exits.length,
          fills: sim.stats.fills + exits.length,
        },
        ticks: sim.ticks + 1,
      }, config),
      orders: sim.positions.map((position, index) => buildExitPaperOrder(position, exits[index])),
      message: `Market is closed (${risk.sessionReason}). Bot stopped.`,
    };
  }

  let positions = sim.positions.map((position) => {
    const live = stocks.find((item) => item.symbol === position.symbol);
    return {
      ...position,
      lastPrice: live?.price ?? position.lastPrice,
    };
  });
  let trades = [...sim.trades];
  let realizedPnl = sim.realizedPnl;
  let tradesTaken = Math.max(sim.tradesTaken, risk?.tradesTaken ?? 0);
  let stats = { ...sim.stats };
  let status: BotStatus = sim.status;
  let message = strategy.decision.reason;
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
    orders.push(
      ...positions.map((position, index) =>
        buildExitPaperOrder(position, exits[index])
      )
    );
    positions = [];
    status = dayPnl >= targetAmount ? "target-hit" : "loss-hit";
    message = dayPnl >= targetAmount ? "Daily target reached. Paper trading stopped." : "Daily loss limit reached.";
  }

  if (status === "running" && positions.length && risk?.squareOffDue) {
    const exits = positions.map((position) => closePosition(position, stocks, config));
    trades = [...exits.map((exit) => exit.trade), ...trades];
    realizedPnl += exits.reduce((total, exit) => total + exit.pnl, 0);
    stats.fills += exits.length;
    stats.orders += exits.length;
    orders.push(
      ...positions.map((position, index) =>
        buildExitPaperOrder(position, exits[index])
      )
    );
    positions = [];
    status = "closed";
    message = "Square-off window reached. Paper positions closed.";
  }

  const stopTriggered = positions.find((position) => isPositionExitTriggered(position));

  if (status === "running" && stopTriggered) {
    const exit = closePosition(stopTriggered, stocks, config);
    trades = [exit.trade, ...trades];
    realizedPnl += exit.pnl;
    stats.fills += 1;
    stats.orders += 1;
    orders.push(buildExitPaperOrder(stopTriggered, exit));
    positions = positions.filter((position) => position.id !== stopTriggered.id);
    message = `${stopTriggered.symbol} exited by target/stop.`;
  }

  if (status === "running" && !positions.length && tradesTaken >= config.maxTrades) {
    message = "Daily max trades reached. Bot will not take more entries today.";
  }

  if (status === "running" && !positions.length && tradesTaken < config.maxTrades) {
    const selectedSignal = strategy.signals.find((signal) => signal.symbol === strategy.decision.symbol);
    const marketClosed = risk?.marketOpen === false;
    const freshEntriesBlocked = risk?.freshEntriesAllowed === false;

    if (marketClosed) {
      message = "Indian market is closed. Backend paper bot is waiting.";
    } else if (freshEntriesBlocked) {
      message = "Fresh entries are blocked by the market-session guard.";
    } else if (strategy.decision.action === "TRADE" && selectedSignal?.eligible) {
      const entrySide = strategy.decision.side ?? selectedSignal.side ?? "BUY";
      const positionSide = positionSideFromEntry(entrySide);
      const entryPrice = getEntryPrice(selectedSignal.price, entrySide, config);
      const quantity = strategy.decision.quantity ?? selectedSignal.recommendedQuantity ?? 0;
      if (quantity <= 0) {
        return {
          next: applyMilestonesToSimulation({
            ...sim,
            stocks,
            positions,
            trades,
            realizedPnl,
            tradesTaken,
            stats,
            status,
            ticks: sim.ticks + 1,
          }, config, [dayPnl]),
          orders,
          message: "Signal passed, but risk sizing returned zero quantity.",
        };
      }
      const slippageCost = selectedSignal.price * (config.slippageBps / 10000) * quantity;
      const position: Position = {
        id: crypto.randomUUID(),
        symbol: selectedSignal.symbol,
        side: positionSide,
        qty: quantity,
        entryPrice,
        lastPrice: selectedSignal.price,
        stopLoss: strategy.decision.stopLossPrice ?? selectedSignal.stopLossPrice,
        targetPrice: strategy.decision.targetPrice ?? selectedSignal.targetPrice,
        openedAt: nowLabel(),
        strategy: selectedSignal.strategy,
        score: selectedSignal.score,
      };
      positions = [position];
      tradesTaken += 1;
      stats.orders += 1;
      stats.fills += 1;
      stats.slippageCost += slippageCost;
      orders.push(
        buildPaperOrder(
          entrySide,
          position.symbol,
          position.qty,
          entryPrice,
          0,
          "ENTRY",
          position.side,
          position.strategy,
          position.score,
          position.stopLoss,
          position.targetPrice
        )
      );
      trades = [
        {
          id: crypto.randomUUID(),
          time: position.openedAt,
          symbol: position.symbol,
          side: entrySide,
          qty: position.qty,
          price: position.entryPrice,
          charges: 0,
          pnl: 0,
          status: "ENTRY",
        },
        ...trades,
      ];
      message = `Backend paper ${position.side.toLowerCase()} entry: ${position.symbol} x ${position.qty}.`;
    }
  }

  return {
    next: applyMilestonesToSimulation({
      ...sim,
      stocks,
      positions,
      trades,
      realizedPnl,
      tradesTaken,
      stats,
      status,
      closedAt: status === "target-hit" || status === "loss-hit" || status === "closed" ? nowLabel() : sim.closedAt,
      ticks: sim.ticks + 1,
    }, config, [dayPnl]),
    orders,
    message,
  };
}

function tickSimulation(sim: Simulation, config: Config): Simulation {
  const stocks = advanceMarket(sim.stocks, sim.status === "running");

  if (sim.status !== "running") {
    return applyMilestonesToSimulation({
      ...sim,
      stocks,
      ticks: sim.ticks + 1,
    }, config);
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
    return applyMilestonesToSimulation({
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
    }, config, [dayPnl]);
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
          return applyMilestonesToSimulation({
            ...sim,
            stocks,
            positions,
            trades,
            realizedPnl,
            tradesTaken,
            stats,
            status,
            ticks: sim.ticks + 1,
          }, config, [dayPnl]);
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

  return applyMilestonesToSimulation({
    ...sim,
    stocks,
    positions,
    trades,
    realizedPnl,
    tradesTaken,
    stats,
    status,
    ticks: sim.ticks + 1,
  }, config, [dayPnl]);
}

function statusLabel(status: BotStatus) {
  const labels: Record<BotStatus, string> = {
    idle: "Idle",
    running: "Running",
    paused: "Paused",
    "target-hit": "Target Hit",
    "loss-hit": "Risk Stop",
    closed: "Closed",
  };
  return labels[status];
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("aindra-theme");
    return stored === "light" || stored === "dark" ? stored : "dark";
  });
  const [config, setConfig] = useState<Config>(() => loadConfig());
  const [sim, setSim] = useState<Simulation>(() => loadSimulation());
  const [reports, setReports] = useState<DailyReport[]>(() => loadReports());
  const [activeView, setActiveView] = useState<"dashboard" | "history" | "analytics">("dashboard");
  const [journalView, setJournalView] = useState<"session" | "history">("session");
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryPayload | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const [brokerError, setBrokerError] = useState("Checking");
  const [strategyPayload, setStrategyPayload] = useState<StrategyPayload | null>(null);
  const [riskState, setRiskState] = useState<RiskState | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [startNotice, setStartNotice] = useState("");
  const [requestToken, setRequestToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("request_token") ?? "";
  });
  const [brokerMessage, setBrokerMessage] = useState("");
  const [brokerBusy, setBrokerBusy] = useState(false);
  const simRef = useRef(sim);
  const configRef = useRef(config);
  const backendPaperBusyRef = useRef(false);

  useEffect(() => {
    simRef.current = sim;
  }, [sim]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  async function refreshBrokerStatus() {
    try {
      const response = await fetch("/api/broker/status");
      if (!response.ok) {
        throw new Error("Broker API unavailable");
      }
      const payload = (await response.json()) as BrokerStatus;
      setBrokerStatus(payload);
      setBrokerError("");
    } catch {
      setBrokerStatus(null);
      setBrokerError("Offline");
    }
  }

  async function refreshServerIntelligence(active = true) {
    try {
      const [strategyResponse, riskResponse, backtestResponse] = await Promise.all([
        fetch(`/api/strategy/signals?${configQuery(config)}`),
        fetch(`/api/risk/state?${configQuery(config)}`),
        fetch("/api/backtest/latest"),
      ]);
      if (!active) {
        return;
      }
      if (strategyResponse.ok) {
        setStrategyPayload((await strategyResponse.json()) as StrategyPayload);
      }
      if (riskResponse.ok) {
        setRiskState((await riskResponse.json()) as RiskState);
      }
      if (backtestResponse.ok) {
        setBacktest((await backtestResponse.json()) as BacktestResult | null);
      }
    } catch {
      if (active) {
        setServerMessage("Server intelligence offline");
      }
    }
  }

  async function refreshTradeHistory(active = true) {
    try {
      const response = await fetch(`/api/trade-history?capital=${configRef.current.capital}&limit=50000`);
      if (!response.ok) {
        throw new Error("Trade history unavailable");
      }
      const payload = (await response.json()) as TradeHistoryPayload;
      if (active) {
        setTradeHistory(payload);
        setHistoryError("");
      }
    } catch {
      if (active) {
        setHistoryError("Trade history unavailable. Start the API server and refresh.");
      }
    }
  }

  async function refreshAnalytics(active = true) {
    try {
      const response = await fetch(`/api/analytics/performance?capital=${configRef.current.capital}&limit=50000`);
      if (!response.ok) {
        throw new Error("Analytics unavailable");
      }
      const payload = (await response.json()) as AnalyticsPayload;
      if (active) {
        setAnalytics(payload);
        setAnalyticsError("");
      }
    } catch {
      if (active) {
        setAnalyticsError("Analytics unavailable. Start the API server and let the strategy scanner collect signals.");
      }
    }
  }

  async function submitPaperOrders(orders: PaperOrderRequest[]) {
    if (!orders.length) {
      return;
    }
    try {
      const responses = await Promise.all(
        orders.map((order) =>
          fetch("/api/orders/paper", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...order, config: configRef.current }),
          })
        )
      );
      const failed = responses.filter((response) => !response.ok).length;
      if (failed) {
        setServerMessage(`${failed} paper order update${failed === 1 ? "" : "s"} failed to record.`);
      }
      await refreshTradeHistory();
      await refreshAnalytics();
      await refreshServerIntelligence();
    } catch {
      setServerMessage("Paper order ledger update failed.");
      setHistoryError("Latest paper order was not written to trade history.");
    }
  }

  async function runBackendPaperCycle() {
    if (backendPaperBusyRef.current) {
      return;
    }

    backendPaperBusyRef.current = true;
    try {
      const query = configQuery(configRef.current);
      const [strategyResponse, riskResponse] = await Promise.all([
        fetch(`/api/strategy/signals?${query}`),
        fetch(`/api/risk/state?${query}`),
      ]);

      if (!strategyResponse.ok || !riskResponse.ok) {
        throw new Error("Backend paper engine unavailable");
      }

      const strategy = (await strategyResponse.json()) as StrategyPayload;
      const risk = (await riskResponse.json()) as RiskState;
      setStrategyPayload(strategy);
      setRiskState(risk);

      const { next, orders, message } = tickBackendPaper(simRef.current, configRef.current, strategy, risk);
      simRef.current = next;
      setSim(next);
      setServerMessage(message);

      await submitPaperOrders(orders);
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : "Backend paper engine unavailable");
    } finally {
      backendPaperBusyRef.current = false;
      refreshServerIntelligence();
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aindra-theme", theme);
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("request_token")) {
      return;
    }
    params.delete("request_token");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  useEffect(() => {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(sim));
  }, [sim]);

  useEffect(() => {
    localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
  }, [reports]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSim((current) => {
        if (brokerStatus) {
          return {
            ...current,
            ticks: current.ticks + 1,
          };
        }
        return tickSimulation(current, config);
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [brokerStatus, config]);

  useEffect(() => {
    let active = true;

    async function refreshIfActive() {
      if (active) {
        await refreshBrokerStatus();
      }
    }

    refreshIfActive();
    const timer = window.setInterval(refreshIfActive, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    refreshServerIntelligence(active);
    const timer = window.setInterval(() => refreshServerIntelligence(active), 12000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [config]);

  useEffect(() => {
    let active = true;

    refreshTradeHistory(active);
    const timer = window.setInterval(() => refreshTradeHistory(active), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [config.capital]);

  useEffect(() => {
    let active = true;

    refreshAnalytics(active);
    const timer = window.setInterval(() => refreshAnalytics(active), 20000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [config.capital]);

  useEffect(() => {
    if (!tradeHistory?.trades.length || !strategyPayload?.signals.length) {
      return;
    }
    const openTrades = tradeHistory.trades.filter((trade) => trade.status === "OPEN" && trade.date === todayKey());
    if (!openTrades.length) {
      return;
    }

    setSim((current) => {
      const existingKeys = new Set(
        current.positions.map((position) => `${position.symbol}:${position.side}:${position.qty}:${position.entryPrice.toFixed(4)}`)
      );
      const missingOpenTrades = openTrades.filter(
        (trade) => !existingKeys.has(`${trade.symbol}:${trade.side}:${trade.quantity}:${trade.entryPrice.toFixed(4)}`)
      );
      const shouldRun = brokerStatus?.tokenState === "ready" && riskState?.marketOpen && !riskState.killSwitchActive;
      const nextStatus =
        current.status === "idle" || current.status === "closed" ? (shouldRun ? "running" : "paused") : current.status;

      if (!missingOpenTrades.length && current.status === nextStatus && current.tradesTaken >= (riskState?.tradesTaken ?? 0)) {
        return current;
      }

      const restoredPositions = restorePositionsFromOpenTrades(missingOpenTrades, strategyPayload.signals, current.stocks, config);
      const restoredTrades = entryTradesFromOpenHistory(missingOpenTrades);
      const existingTradeIds = new Set(current.trades.map((trade) => trade.id));
      const newTrades = restoredTrades.filter((trade) => !existingTradeIds.has(trade.id));

      return applyMilestonesToSimulation({
        ...current,
        positions: [...current.positions, ...restoredPositions],
        trades: [...newTrades, ...current.trades],
        tradesTaken: Math.max(current.tradesTaken, riskState?.tradesTaken ?? openTrades.length),
        stats: {
          ...current.stats,
          orders: Math.max(current.stats.orders, openTrades.length),
          fills: Math.max(current.stats.fills, openTrades.length),
        },
        status: nextStatus,
        startedAt: current.startedAt ?? timeLabelFromIso(openTrades[0].entryAt),
      }, config);
    });
  }, [brokerStatus?.tokenState, config, riskState, strategyPayload, tradeHistory]);

  useEffect(() => {
    if (!brokerStatus || sim.status !== "running") {
      return;
    }
    runBackendPaperCycle();
    const timer = window.setInterval(runBackendPaperCycle, 7000);
    return () => window.clearInterval(timer);
  }, [brokerStatus, sim.status]);

  const targetAmount = (config.capital * config.targetPct) / 100;
  const lossAmount = (config.capital * config.maxLossPct) / 100;
  const unrealizedPnl = useMemo(
    () => sim.positions.reduce((total, position) => total + estimatePositionPnl(position, sim.stocks, config), 0),
    [config, sim.positions, sim.stocks]
  );
  const dayPnl = sim.realizedPnl + unrealizedPnl;
  const currentMilestones = useMemo(
    () => normalizeMilestones(sim.milestones, config.capital),
    [config.capital, sim.milestones]
  );
  const gaveBackFromPeak = Math.max(0, currentMilestones.peakPnl - dayPnl);
  const rankedStocks = useMemo(() => [...sim.stocks].sort((a, b) => b.score - a.score), [sim.stocks]);
  const scannerRows = useMemo(() => {
    if (strategyPayload?.signals.length) {
      return scannerRowsFromSignals(strategyPayload.signals);
    }
    return scannerRowsFromStocks(rankedStocks);
  }, [rankedStocks, strategyPayload]);
  const scannerSource = strategyPayload?.source ?? scannerRows[0]?.source ?? "local-sim";
  const eligibleStocks = useMemo(
    () =>
      rankedStocks.filter(
        (item) =>
          item.price <= config.capital * 0.98 &&
          item.score >= config.minScore &&
          Math.abs(item.momentum) >= config.minMomentumPct &&
          item.spreadBps <= config.maxSpreadBps
      ),
    [config, rankedStocks]
  );
  const topSignal = eligibleStocks[0] ?? rankedStocks[0];
  const progress = clamp((dayPnl / targetAmount) * 100, -100, 100);
  const riskProgress = clamp((Math.abs(Math.min(dayPnl, 0)) / lossAmount) * 100, 0, 100);
  const sessionLocked = sim.status === "target-hit" || sim.status === "loss-hit" || sim.status === "closed";
  const effectiveTradesTaken = Math.max(sim.tradesTaken, riskState?.tradesTaken ?? 0);
  const entryLimitReached = effectiveTradesTaken >= config.maxTrades;
  const botCanArm = riskState ? riskState.botArmAllowed : true;
  const latestReport = reports[0];
  const closedReports = reports.filter((report) => report.status !== "idle" && report.status !== "running");
  const profitableReports = closedReports.filter((report) => report.netPnl > 0);
  const reportWinRate = closedReports.length ? Math.round((profitableReports.length / closedReports.length) * 100) : 0;
  const historyTotals = tradeHistory?.totals;
  const latestHistoryDay = tradeHistory?.daily[0];
  const canUseKiteAuth = Boolean(brokerStatus?.apiConfigured) && !brokerBusy;
  const canConnectKite = canUseKiteAuth && Boolean(requestToken.trim());
  const backendTopSignal = strategyPayload?.signals[0];
  const backendEligible = strategyPayload?.signals.filter((signal) => signal.eligible).length ?? 0;
  const displayedSignalSymbol = strategyPayload?.decision.symbol ?? topSignal?.symbol ?? "-";
  const displayedSignalScore = backendTopSignal?.score ?? topSignal?.score ?? 0;
  const displayedMomentum = backendTopSignal?.momentumPct ?? topSignal?.momentum ?? 0;
  const displayedRelativeStrength = backendTopSignal?.relativeStrengthPct ?? 0;
  const displayedMarketRegime = strategyPayload?.marketRegime?.label ?? backendTopSignal?.marketRegime?.label ?? "unknown";
  const displayedNetRewardRisk = backendTopSignal?.netRewardRisk ?? 0;
  const displayedStrategy = strategyPayload?.decision.strategy ?? backendTopSignal?.strategy ?? config.strategyMode;
  const displayedSide = strategyPayload?.decision.side ?? backendTopSignal?.side ?? (displayedMomentum < 0 ? "SELL" : "BUY");
  const displayedDirection = displayedSide === "SELL" ? "Short" : "Long";
  const displayedAgent = entryLimitReached ? "LOCKED" : (strategyPayload?.decision.action ?? "WAIT");
  const strategyBrainMessage = entryLimitReached
    ? `Daily max trades reached (${effectiveTradesTaken}/${config.maxTrades}). New long or short entries are blocked today.`
    : (strategyPayload?.decision.reason ?? serverMessage);
  const rateLimitDelayed = Object.values(brokerStatus?.rateLimits ?? {}).reduce((total, item) => total + item.delayed, 0);
  const paperEngineLabel = brokerStatus
    ? brokerStatus.dataSource === "kite-ws"
      ? "Kite Stream"
      : brokerStatus.dataSource === "kite-rest"
        ? "Kite Paper"
        : "Server Paper"
    : "Local Sim";
  const marketStateLabel = riskState?.sessionPhase
    ? `${riskState.sessionPhase}${riskState.freshEntriesAllowed ? " entries" : ""}`
    : riskState?.marketOpen
      ? "Market open"
      : "Market closed";
  const marketStatusLabel = riskState?.marketOpen
    ? riskState.freshEntriesAllowed
      ? "Market Open"
      : "Open - Entries Blocked"
    : riskState?.sessionPhase === "preopen"
      ? "Pre-open"
    : riskState?.botArmAllowed
      ? "Arm Ready"
      : "Market Closed";
  const nextOpenLabel = formatNextOpen(riskState?.nextOpenAt);
  const marketBannerText = riskState?.marketOpen
    ? riskState.freshEntriesAllowed
      ? "Market is open. Bot can take fresh paper entries when strategy gates pass."
      : riskState.botArmAllowed
        ? "Bot can be armed now and will wait until fresh entries are allowed."
        : "Market is open, but fresh entries are blocked by the session guard."
    : riskState?.botArmAllowed
      ? `Bot can be armed now and will wait for market open.${nextOpenLabel ? ` Next open: ${nextOpenLabel}.` : ""}`
      : `Market is closed${riskState?.sessionReason ? `: ${riskState.sessionReason}` : ""}.${nextOpenLabel ? ` Next open: ${nextOpenLabel}.` : ""}`;

  useEffect(() => {
    if (!sessionLocked) {
      return;
    }
    const reportSim = applyMilestonesToSimulation(sim, config, [dayPnl]);
    const report = buildDailyReport(reportSim, config, dayPnl);
    setReports((current) => {
      const existing = current.find((item) => item.id === report.id);
      if (existing && JSON.stringify(existing) === JSON.stringify(report)) {
        return current;
      }
      return [report, ...current.filter((item) => item.id !== report.id)].slice(0, 40);
    });
  }, [config, dayPnl, sessionLocked, sim]);

  function updateConfig<Key extends keyof Config>(key: Key, value: Config[Key]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function startBot() {
    if (!brokerStatus) {
      setStartNotice("API server is offline. Start the backend before starting the bot.");
      setServerMessage("API server must be online before starting the bot.");
      return;
    }
    if (!brokerStatus.apiConfigured) {
      setStartNotice("Kite API key and secret are required before starting.");
      setBrokerMessage("Add Kite API key and secret before starting the bot.");
      setServerMessage("Kite API key and secret are required before starting.");
      return;
    }
    if (brokerStatus.tokenState !== "ready") {
      setStartNotice("Connect Zerodha first. The bot will not start without today's Kite token.");
      setBrokerMessage("Connect Zerodha first, then start the bot.");
      setServerMessage("Zerodha is not connected. Complete daily login before starting.");
      return;
    }
    if ((riskState?.tradesTaken ?? 0) >= config.maxTrades) {
      setStartNotice(`Daily max trades reached (${riskState?.tradesTaken ?? 0}/${config.maxTrades}). Bot cannot restart today.`);
      setServerMessage("Daily max trades reached. Restart/reset cannot bypass the risk guard.");
      return;
    }
    if ((riskState?.dayPnl ?? 0) <= -lossAmount) {
      setStartNotice("Daily loss limit reached. Bot cannot restart today.");
      setServerMessage("Daily loss limit reached. Restart/reset cannot bypass the risk guard.");
      return;
    }
    setStartNotice("");
    setSim((current) => ({
      ...current,
      status: current.status === "idle" ? "running" : current.status,
      startedAt: current.startedAt ?? nowLabel(),
    }));
  }

  function pauseBot() {
    setSim((current) => ({
      ...current,
      status: current.status === "running" ? "paused" : current.status === "paused" ? "running" : current.status,
    }));
  }

  function closeDay() {
    const current = simRef.current;
    const exits = current.positions.map((position) => closePosition(position, current.stocks, config));
    const preClosePnl =
      current.realizedPnl +
      current.positions.reduce((total, position) => total + estimatePositionPnl(position, current.stocks, config), 0);
    const next = applyMilestonesToSimulation({
      ...current,
      positions: [],
      trades: [...exits.map((exit) => exit.trade), ...current.trades],
      realizedPnl: current.realizedPnl + exits.reduce((total, exit) => total + exit.pnl, 0),
      status: "closed",
      closedAt: nowLabel(),
      stats: {
        ...current.stats,
        orders: current.stats.orders + exits.length,
        fills: current.stats.fills + exits.length,
      },
    }, config, [preClosePnl]);
    const exitOrders = current.positions.map((position, index) => buildExitPaperOrder(position, exits[index]));
    simRef.current = next;
    setSim(next);
    void submitPaperOrders(exitOrders);
  }

  function resetDay() {
    setSim(createInitialSimulation());
  }

  function exportJournal() {
    const rows = [...sim.trades].reverse().map((trade) => ({
      time: trade.time,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.qty,
      price: trade.price.toFixed(2),
      charges: trade.charges.toFixed(2),
      netPnl: trade.pnl.toFixed(2),
      status: trade.status,
    }));
    downloadCsv(`aindra-journal-${sim.tradeDate}.csv`, toCsv(rows));
  }

  function exportTradeHistory() {
    if (!tradeHistory?.trades.length) {
      return;
    }
    const rows = tradeHistory.trades.map((trade) => ({
      date: trade.date,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      entryAt: trade.entryAt,
      exitAt: trade.exitAt ?? "",
      entryPrice: trade.entryPrice.toFixed(2),
      exitPrice: trade.exitPrice?.toFixed(2) ?? "",
      charges: trade.charges.toFixed(2),
      netPnl: trade.netPnl.toFixed(2),
      tradeReturnPct: trade.netPct.toFixed(2),
      capitalReturnPct: trade.capitalPct.toFixed(2),
      status: trade.status,
      mode: trade.mode,
    }));
    downloadCsv(`aindra-trade-history-${todayKey()}.csv`, toCsv(rows));
  }

  function exportAnalytics() {
    if (!analytics) {
      return;
    }
    const rows = [
      ...analytics.tradePerformance.byStrategy.map((row) => ({
        section: "trade-by-strategy",
        key: row.key,
        samples: row.trades,
        eligible: "",
        tradeDecisions: "",
        winRate: row.winRate.toFixed(2),
        netPnl: row.netPnl.toFixed(2),
        avgScore: "",
        avgRelativeStrength: "",
        avgNetRewardRisk: "",
      })),
      ...analytics.signalQuality.byStrategy.map((row) => ({
        section: "signal-by-strategy",
        key: row.key,
        samples: row.samples,
        eligible: row.eligible,
        tradeDecisions: row.tradeDecisions,
        winRate: "",
        netPnl: "",
        avgScore: row.avgScore.toFixed(2),
        avgRelativeStrength: row.avgRelativeStrength.toFixed(2),
        avgNetRewardRisk: row.avgNetRewardRisk.toFixed(2),
      })),
      ...analytics.signalQuality.byRegime.map((row) => ({
        section: "signal-by-regime",
        key: row.key,
        samples: row.snapshots,
        eligible: row.eligibleSignals,
        tradeDecisions: row.tradeDecisions,
        winRate: "",
        netPnl: "",
        avgScore: "",
        avgRelativeStrength: "",
        avgNetRewardRisk: "",
      })),
    ];
    downloadCsv(`aindra-analytics-${todayKey()}.csv`, toCsv(rows));
  }

  function exportReports() {
    const rows = reports.map((report) => ({
      date: report.date,
      status: statusLabel(report.status),
      startedAt: report.startedAt,
      closedAt: report.closedAt,
      capital: report.capital,
      targetAmount: report.targetAmount.toFixed(2),
      lossAmount: report.lossAmount.toFixed(2),
      netPnl: report.netPnl.toFixed(2),
      tradesTaken: report.tradesTaken,
      fills: report.fills,
      rejections: report.rejections,
      charges: report.charges.toFixed(2),
      slippageCost: report.slippageCost.toFixed(2),
      peakPnl: (report.peakPnl ?? 0).toFixed(2),
      peakPct: (report.peakPct ?? 0).toFixed(2),
      maxDrawdownPnl: (report.maxDrawdownPnl ?? 0).toFixed(2),
      maxDrawdownPct: (report.maxDrawdownPct ?? 0).toFixed(2),
      milestonesHit: report.milestonesHit ?? "-",
      gaveBackFromPeak: (report.gaveBackFromPeak ?? 0).toFixed(2),
    }));
    downloadCsv(`aindra-reports-${todayKey()}.csv`, toCsv(rows));
  }

  async function openZerodhaLogin() {
    setBrokerBusy(true);
    setStartNotice("");
    setBrokerMessage("");
    try {
      const response = await fetch("/api/broker/zerodha/login-url");
      const payload = (await response.json()) as { loginUrl?: string; error?: string };
      if (!response.ok || !payload.loginUrl) {
        throw new Error(payload.error ?? "Unable to create Zerodha login URL");
      }
      window.open(payload.loginUrl, "_blank", "noopener,noreferrer");
      setBrokerMessage("Zerodha login opened. Paste the request token here after redirect.");
    } catch (error) {
      setBrokerMessage(error instanceof Error ? error.message : "Unable to open Zerodha login");
    } finally {
      setBrokerBusy(false);
    }
  }

  async function connectZerodhaSession() {
    const token = requestToken.trim();
    if (!token) {
      setBrokerMessage("Paste the Zerodha request token first.");
      return;
    }

    setBrokerBusy(true);
    setBrokerMessage("");
    try {
      const response = await fetch("/api/broker/zerodha/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestToken: token }),
      });
      const payload = (await response.json()) as BrokerStatus | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Unable to connect Zerodha session");
      }
      setBrokerStatus(payload as BrokerStatus);
      setBrokerMessage("Zerodha token connected and saved for today. Live orders are still locked.");
      setStartNotice("");
      setRequestToken("");
    } catch (error) {
      setBrokerMessage(error instanceof Error ? error.message : "Unable to connect Zerodha session");
    } finally {
      setBrokerBusy(false);
      refreshBrokerStatus();
    }
  }

  async function runBacktestNow() {
    setBacktestBusy(true);
    setServerMessage("");
    try {
      const response = await fetch("/api/backtest/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ config, days: 10 }),
      });
      const payload = (await response.json()) as BacktestResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Backtest failed");
      }
      setBacktest(payload as BacktestResult);
      setServerMessage("Backtest completed with current strategy gates.");
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : "Backtest failed");
    } finally {
      setBacktestBusy(false);
      refreshServerIntelligence();
    }
  }

  async function toggleKillSwitch() {
    const active = !riskState?.killSwitchActive;
    try {
      const response = await fetch("/api/risk/kill-switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active, reason: "dashboard" }),
      });
      if (!response.ok) {
        throw new Error("Risk server unavailable");
      }
      const payload = (await response.json()) as RiskState;
      setRiskState((current) => ({ ...(current ?? payload), ...payload }));
      setServerMessage(active ? "Kill switch activated." : "Kill switch released.");
    } catch (error) {
      setServerMessage(error instanceof Error ? error.message : "Unable to update kill switch");
    }
  }

  const tradeHistoryView = (
    <section className="history-page">
      <div className="history-page-header">
        <div>
          <p className="eyebrow">All Days Ledger</p>
          <h2>Trade History</h2>
        </div>
        <div className="history-page-actions">
          <button className="mini-action" type="button" onClick={() => refreshTradeHistory()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button className="mini-action" type="button" onClick={exportTradeHistory} disabled={!tradeHistory?.trades.length}>
            <Download size={16} aria-hidden="true" />
            <span>History CSV</span>
          </button>
        </div>
      </div>

      <Panel title="Net Profit / Loss" icon={<Database size={18} />}>
        <div className="history-view">
          <div className="history-summary">
            <div>
              <span>All Days Net</span>
              <strong className={(historyTotals?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                {formatCurrency(historyTotals?.netPnl ?? 0, 2)}
              </strong>
              <small>{formatPercent(historyTotals?.netPct ?? 0)} of capital</small>
            </div>
            <div>
              <span>Today Net</span>
              <strong className={(latestHistoryDay?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                {latestHistoryDay ? formatCurrency(latestHistoryDay.netPnl, 2) : formatCurrency(0, 2)}
              </strong>
              <small>{latestHistoryDay ? formatPercent(latestHistoryDay.netPct) : "0.00%"} of capital</small>
            </div>
            <div>
              <span>Closed Trades</span>
              <strong>{historyTotals?.closedTrades ?? 0}</strong>
              <small>{formatPercent(historyTotals?.winRate ?? 0, 0)} win rate</small>
            </div>
            <div>
              <span>Open / Unmatched</span>
              <strong className={(historyTotals?.openTrades ?? 0) > 0 ? "warning" : undefined}>
                {historyTotals?.openTrades ?? 0}
              </strong>
              <small>{historyTotals?.rejectedOrders ?? 0} rejected</small>
            </div>
          </div>

          {historyError ? <p className="broker-note warning">{historyError}</p> : null}
          {(historyTotals?.openTrades ?? 0) > 0 ? (
            <p className="broker-note warning">
              {historyTotals?.openTrades} entry {historyTotals?.openTrades === 1 ? "order has" : "orders have"} no recorded exit. Closed net excludes unmatched rows.
            </p>
          ) : null}

          {tradeHistory?.daily.length ? (
            <div className="daily-history-strip">
              {tradeHistory.daily.slice(0, 6).map((day) => (
                <div key={day.date}>
                  <span>{formatDate(day.date)}</span>
                  <strong className={day.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(day.netPnl, 2)}</strong>
                  <small>
                    {formatPercent(day.netPct)} | {day.trades} trade{day.trades === 1 ? "" : "s"}
                  </small>
                </div>
              ))}
            </div>
          ) : null}

          <div className="history-table">
            <div className="history-head">
              <span>Date</span>
              <span>Entry</span>
              <span>Exit</span>
              <span>Symbol</span>
              <span>Side</span>
              <span>Qty</span>
              <span>Entry</span>
              <span>Exit</span>
              <span>Charges</span>
              <span>Net P&L</span>
              <span>Return</span>
              <span>Status</span>
            </div>
            {tradeHistory?.trades.length ? (
              tradeHistory.trades.map((trade) => (
                <div className="history-row" key={trade.id}>
                  <span>{formatDate(trade.date)}</span>
                  <span>{formatDateTime(trade.entryAt)}</span>
                  <span>{formatDateTime(trade.exitAt)}</span>
                  <strong>{trade.symbol}</strong>
                  <span className={trade.side === "LONG" ? "gain" : "loss"}>{trade.side}</span>
                  <span>{trade.quantity}</span>
                  <span>{formatCurrency(trade.entryPrice, 2)}</span>
                  <span>{trade.exitPrice ? formatCurrency(trade.exitPrice, 2) : "-"}</span>
                  <span>{formatCurrency(trade.charges, 2)}</span>
                  <span className={trade.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(trade.netPnl, 2)}</span>
                  <span className={trade.netPct >= 0 ? "gain" : "loss"}>{formatPercent(trade.netPct)}</span>
                  <span className={trade.status === "OPEN" ? "warning" : undefined}>{trade.status}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No backend trade history yet</div>
            )}
          </div>
        </div>
      </Panel>
    </section>
  );

  const analyticsView = (
    <section className="analytics-page">
      <div className="history-page-header">
        <div>
          <p className="eyebrow">V2 Evidence Layer</p>
          <h2>Analytics</h2>
        </div>
        <div className="history-page-actions">
          <button className="mini-action" type="button" onClick={() => refreshAnalytics()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button className="mini-action" type="button" onClick={exportAnalytics} disabled={!analytics}>
            <Download size={16} aria-hidden="true" />
            <span>Analytics CSV</span>
          </button>
        </div>
      </div>

      <Panel title="Evidence Summary" icon={<BarChart3 size={18} />}>
        <div className="analytics-summary">
          <div>
            <span>Signal Snapshots</span>
            <strong>{analytics?.totals.signalSnapshots ?? 0}</strong>
            <small>{analytics?.totals.totalSignals ?? 0} total signals</small>
          </div>
          <div>
            <span>Eligible Rate</span>
            <strong>{formatPercent(analytics?.totals.eligibleRate ?? 0, 1)}</strong>
            <small>{analytics?.totals.eligibleSignals ?? 0} eligible</small>
          </div>
          <div>
            <span>Trade Decisions</span>
            <strong>{analytics?.totals.tradeDecisions ?? 0}</strong>
            <small>{analytics?.totals.waitDecisions ?? 0} waits</small>
          </div>
          <div>
            <span>Closed Trade Net</span>
            <strong className={(analytics?.totals.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
              {formatCurrency(analytics?.totals.netPnl ?? 0, 2)}
            </strong>
            <small>{formatPercent(analytics?.totals.winRate ?? 0, 0)} win rate</small>
          </div>
        </div>
        {analyticsError ? <p className="broker-note warning">{analyticsError}</p> : null}
      </Panel>

      <div className="analytics-grid">
        <Panel title="Trade Performance by Strategy" icon={<Activity size={18} />}>
          <div className="analytics-table trade-performance-table">
            <div className="analytics-head">
              <span>Strategy</span>
              <span>Trades</span>
              <span>Win</span>
              <span>Net P&L</span>
              <span>PF</span>
            </div>
            {analytics?.tradePerformance.byStrategy.length ? (
              analytics.tradePerformance.byStrategy.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{strategyLabel(row.key)}</strong>
                  <span>{row.trades}</span>
                  <span>{formatPercent(row.winRate, 0)}</span>
                  <span className={row.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(row.netPnl, 2)}</span>
                  <span>{row.profitFactor.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No closed trades with strategy metadata yet</div>
            )}
          </div>
        </Panel>

        <Panel title="Signal Quality by Strategy" icon={<Cpu size={18} />}>
          <div className="analytics-table signal-quality-table">
            <div className="analytics-head">
              <span>Strategy</span>
              <span>Samples</span>
              <span>Eligible</span>
              <span>Score</span>
              <span>RS</span>
              <span>Net R:R</span>
            </div>
            {analytics?.signalQuality.byStrategy.length ? (
              analytics.signalQuality.byStrategy.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{strategyLabel(row.key)}</strong>
                  <span>{row.samples}</span>
                  <span>{formatPercent(row.eligibleRate, 0)}</span>
                  <span>{row.avgScore.toFixed(1)}</span>
                  <span className={row.avgRelativeStrength >= 0 ? "gain" : "loss"}>{formatPercent(row.avgRelativeStrength)}</span>
                  <span>{row.avgNetRewardRisk.toFixed(2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No signal snapshots yet</div>
            )}
          </div>
        </Panel>
      </div>

      <div className="analytics-grid">
        <Panel title="Symbol Performance" icon={<Database size={18} />}>
          <div className="analytics-table symbol-performance-table">
            <div className="analytics-head">
              <span>Symbol</span>
              <span>Trades</span>
              <span>Win</span>
              <span>Net P&L</span>
              <span>Charges</span>
            </div>
            {analytics?.tradePerformance.bySymbol.length ? (
              analytics.tradePerformance.bySymbol.slice(0, 10).map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{row.key}</strong>
                  <span>{row.trades}</span>
                  <span>{formatPercent(row.winRate, 0)}</span>
                  <span className={row.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(row.netPnl, 2)}</span>
                  <span>{formatCurrency(row.charges, 2)}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No closed symbol performance yet</div>
            )}
          </div>
        </Panel>

        <Panel title="Market Regime Samples" icon={<TrendingUp size={18} />}>
          <div className="analytics-table regime-table">
            <div className="analytics-head">
              <span>Regime</span>
              <span>Snapshots</span>
              <span>Eligible</span>
              <span>Trades</span>
            </div>
            {analytics?.signalQuality.byRegime.length ? (
              analytics.signalQuality.byRegime.map((row) => (
                <div className="analytics-row" key={row.key}>
                  <strong>{row.key}</strong>
                  <span>{row.snapshots}</span>
                  <span>{formatPercent(row.eligibleRate, 0)}</span>
                  <span>{row.tradeDecisions}</span>
                </div>
              ))
            ) : (
              <div className="journal-empty">No regime samples yet</div>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Recent Signal Decisions" icon={<FileClock size={18} />}>
        <div className="analytics-table recent-signal-table">
          <div className="analytics-head">
            <span>Time</span>
            <span>Symbol</span>
            <span>Side</span>
            <span>Strategy</span>
            <span>Score</span>
            <span>RS</span>
            <span>Net R:R</span>
            <span>Status</span>
            <span>Reason</span>
          </div>
          {analytics?.signalQuality.recent.length ? (
            analytics.signalQuality.recent.slice(0, 20).map((row) => (
              <div className="analytics-row" key={row.id}>
                <span>{formatDateTime(row.createdAt)}</span>
                <strong>{row.symbol}</strong>
                <span className={row.side === "SELL" ? "loss" : "gain"}>{row.side === "SELL" ? "Short" : "Long"}</span>
                <span>{strategyLabel(row.strategy)}</span>
                <span>{row.score}</span>
                <span className={row.relativeStrengthPct >= 0 ? "gain" : "loss"}>{formatPercent(row.relativeStrengthPct)}</span>
                <span>{row.netRewardRisk.toFixed(2)}</span>
                <span className={row.eligible ? "gain" : "warning"}>{row.eligible ? "ELIGIBLE" : "BLOCKED"}</span>
                <span>{row.gateReasons.length ? row.gateReasons.join(", ") : row.regime}</span>
              </div>
            ))
          ) : (
            <div className="journal-empty">No recent signal decisions yet</div>
          )}
        </div>
      </Panel>
    </section>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="Aindra Trader">
          <div className="brand-mark">
            <Bot size={22} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Paper Desk</p>
            <h1>Aindra Trader</h1>
          </div>
        </div>

        <div className="session-strip" aria-label="Market session">
          <span>{MARKET_OPEN}</span>
          <div className="session-line">
            <span style={{ width: `${Math.min(74, 16 + sim.ticks * 1.5)}%` }} />
          </div>
          <span>{MARKET_CLOSE}</span>
        </div>

        <div className="top-actions">
          <div className={`market-pill ${riskState?.marketOpen ? "open" : "closed"}`}>
            <Radio size={15} aria-hidden="true" />
            <span>{marketStatusLabel}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
          </button>
          <div className={`status-pill ${sim.status}`}>
            <Radio size={15} aria-hidden="true" />
            <span>{statusLabel(sim.status)}</span>
          </div>
        </div>
      </header>

      <main className="workspace">
        <nav className="app-tabs" aria-label="Application views">
          <button
            type="button"
            className={activeView === "dashboard" ? "active" : ""}
            onClick={() => setActiveView("dashboard")}
          >
            <Activity size={16} aria-hidden="true" />
            <span>Dashboard</span>
          </button>
          <button
            type="button"
            className={activeView === "history" ? "active" : ""}
            onClick={() => setActiveView("history")}
          >
            <Database size={16} aria-hidden="true" />
            <span>Trade History</span>
          </button>
          <button
            type="button"
            className={activeView === "analytics" ? "active" : ""}
            onClick={() => setActiveView("analytics")}
          >
            <BarChart3 size={16} aria-hidden="true" />
            <span>Analytics</span>
          </button>
        </nav>

        {activeView === "dashboard" ? (
          <>
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">NSE Equity Intraday</p>
            <h2>{formatCurrency(config.capital)} daily capital</h2>
            <div className="target-grid">
              <div>
                <span>Net P&L</span>
                <strong className={dayPnl >= 0 ? "gain" : "loss"}>{formatCurrency(dayPnl, 2)}</strong>
              </div>
              <div>
                <span>Target</span>
                <strong>{formatCurrency(targetAmount)}</strong>
              </div>
              <div>
                <span>Max Loss</span>
                <strong>{formatCurrency(lossAmount)}</strong>
              </div>
            </div>
            <div className="progress-stack" aria-label="Daily performance">
              <div className="target-track">
                <span style={{ width: `${Math.max(0, progress)}%` }} />
              </div>
              <div className="risk-track">
                <span style={{ width: `${riskProgress}%` }} />
              </div>
            </div>
          </div>

          <div className="command-cluster">
            <div className={`market-banner ${riskState?.marketOpen ? "open" : "closed"}`}>
              <strong>{marketStatusLabel}</strong>
              <span>{marketBannerText}</span>
            </div>
            <button
              className="primary-action"
              type="button"
              onClick={startBot}
              disabled={sim.status !== "idle" || sessionLocked || riskState?.killSwitchActive}
              title={
                brokerStatus?.tokenState !== "ready"
                  ? "Connect Zerodha before starting"
                  : botCanArm && !riskState?.freshEntriesAllowed
                    ? "Arm bot and wait for entry window"
                    : "Start bot"
              }
            >
              <Play size={18} aria-hidden="true" />
              <span>{botCanArm && !riskState?.freshEntriesAllowed ? "Arm Bot" : "Start Bot"}</span>
            </button>
            <button
              className="ghost-action"
              type="button"
              onClick={pauseBot}
              disabled={sim.status !== "running" && sim.status !== "paused"}
            >
              {sim.status === "paused" ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
              <span>{sim.status === "paused" ? "Resume" : "Pause"}</span>
            </button>
            <button
              className="ghost-action danger"
              type="button"
              onClick={closeDay}
              disabled={sim.status === "idle" || sessionLocked}
            >
              <Square size={17} aria-hidden="true" />
              <span>Close Day</span>
            </button>
            <button className="icon-button wide" type="button" onClick={resetDay} title="Reset day" aria-label="Reset day">
              <RefreshCw size={18} aria-hidden="true" />
            </button>
            {startNotice ? (
              <div className="command-alert" role="alert">
                {startNotice}
              </div>
            ) : null}
          </div>
        </section>

        <section className="metric-grid" aria-label="Daily metrics">
          <MetricCard icon={<WalletCards size={20} />} label="Capital" value={formatCurrency(config.capital)} />
          <MetricCard icon={<TrendingUp size={20} />} label="Target" value={`${config.targetPct}%`} detail={formatCurrency(targetAmount)} tone="gain" />
          <MetricCard icon={<ShieldCheck size={20} />} label="Risk Stop" value={`${config.maxLossPct}%`} detail={formatCurrency(lossAmount)} tone="loss" />
          <MetricCard icon={<Activity size={20} />} label="Trades" value={`${effectiveTradesTaken}/${config.maxTrades}`} detail={`${sim.stats.fills} fills`} />
          <MetricCard icon={<PlugZap size={20} />} label="Engine" value={paperEngineLabel} detail={marketStateLabel} />
        </section>

        <section className="main-grid">
          <div className="left-stack">
            <Panel title="Strategy Scanner" icon={<Cpu size={18} />}>
              <div className="panel-meta">
                <span>{sourceLabel(scannerSource)}</span>
                <span>{strategyPayload ? new Date(strategyPayload.generatedAt).toLocaleTimeString("en-IN") : "waiting"}</span>
              </div>
              <div className="scanner-list">
                {scannerRows.slice(0, 7).map((item) => {
                  return (
                    <div className="scanner-row" key={item.symbol}>
                      <div className="symbol-block">
                        <strong>{item.symbol}</strong>
                        <span>{item.sector}</span>
                      </div>
                      <div className="price-block">
                        <strong>{formatCurrency(item.price, 2)}</strong>
                        <span className={item.changePct >= 0 ? "gain" : "loss"}>
                          {item.changePct >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                          {item.changePct.toFixed(2)}%
                        </span>
                      </div>
                      <div className="score-meter" aria-label={`${item.symbol} score ${item.score}`}>
                        <span style={{ width: `${item.score}%` }} />
                      </div>
                      <div className="compact-data">
                        <span className={item.side === "SELL" ? "loss" : "gain"}>{item.side === "SELL" ? "Short" : "Long"}</span>
                        <span>{formatNumber(item.volume)}</span>
                        <span>{item.spreadBps.toFixed(1)} bps</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Open Position" icon={<CircleDollarSign size={18} />}>
              {sim.positions.length ? (
                <div className="position-table">
                  {sim.positions.map((position) => {
                    const pnl = estimatePositionPnl(position, sim.stocks, config);
                    return (
                      <div className="position-row" key={position.id}>
                        <div>
                          <strong>{position.symbol}</strong>
                          <span className={position.side === "SHORT" ? "loss" : "gain"}>
                            {position.side === "SHORT" ? "Short" : "Long"} {position.qty} qty
                          </span>
                        </div>
                        <div>
                          <span>Entry</span>
                          <strong>{formatCurrency(position.entryPrice, 2)}</strong>
                        </div>
                        <div>
                          <span>LTP</span>
                          <strong>{formatCurrency(position.lastPrice, 2)}</strong>
                        </div>
                        <div>
                          <span>Net</span>
                          <strong className={pnl >= 0 ? "gain" : "loss"}>{formatCurrency(pnl, 2)}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <Activity size={22} aria-hidden="true" />
                  <span>No open exposure</span>
                </div>
              )}
            </Panel>
          </div>

          <div className="right-stack">
            <Panel title="Risk Engine" icon={<ShieldCheck size={18} />}>
              <div className="control-grid">
                <label>
                  <span>Capital</span>
                  <input
                    type="number"
                    min={1000}
                    step={500}
                    value={config.capital}
                    onChange={(event) => updateConfig("capital", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Strategy</span>
                  <select
                    value={config.strategyMode}
                    onChange={(event) => updateConfig("strategyMode", event.target.value as Config["strategyMode"])}
                  >
                    <option value="hybrid">Hybrid</option>
                    <option value="momentum">Momentum</option>
                    <option value="mean-reversion">Mean Reversion</option>
                    <option value="vwap-pullback">VWAP Pullback</option>
                    <option value="opening-range">Opening Range</option>
                  </select>
                </label>
                <label>
                  <span>Profit Target</span>
                  <input
                    type="number"
                    min={0.5}
                    max={5}
                    step={0.25}
                    value={config.targetPct}
                    onChange={(event) => updateConfig("targetPct", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Max Loss</span>
                  <input
                    type="number"
                    min={0.25}
                    max={3}
                    step={0.25}
                    value={config.maxLossPct}
                    onChange={(event) => updateConfig("maxLossPct", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Risk / Trade</span>
                  <input
                    type="number"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={config.riskPerTradePct}
                    onChange={(event) => updateConfig("riskPerTradePct", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Max Trades</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    step={1}
                    value={config.maxTrades}
                    onChange={(event) => updateConfig("maxTrades", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Min Score</span>
                  <input
                    type="number"
                    min={40}
                    max={95}
                    step={1}
                    value={config.minScore}
                    onChange={(event) => updateConfig("minScore", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Max Spread</span>
                  <input
                    type="number"
                    min={3}
                    max={30}
                    step={1}
                    value={config.maxSpreadBps}
                    onChange={(event) => updateConfig("maxSpreadBps", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Stop Loss</span>
                  <input
                    type="number"
                    min={0.3}
                    max={2}
                    step={0.1}
                    value={config.stopLossPct}
                    onChange={(event) => updateConfig("stopLossPct", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Trade Target</span>
                  <input
                    type="number"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={config.takeProfitPct}
                    onChange={(event) => updateConfig("takeProfitPct", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>ATR Stop x</span>
                  <input
                    type="number"
                    min={0.7}
                    max={3}
                    step={0.1}
                    value={config.atrStopMultiplier}
                    onChange={(event) => updateConfig("atrStopMultiplier", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Min Net R:R</span>
                  <input
                    type="number"
                    min={0.8}
                    max={3}
                    step={0.1}
                    value={config.minNetRewardRisk}
                    onChange={(event) => updateConfig("minNetRewardRisk", Number(event.target.value))}
                  />
                </label>
              </div>
              <label className="slider-row">
                <span>Slippage</span>
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={config.slippageBps}
                  onChange={(event) => updateConfig("slippageBps", Number(event.target.value))}
                />
                <strong>{config.slippageBps} bps</strong>
              </label>
              <label className="slider-row">
                <span>Momentum</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={config.minMomentumPct}
                  onChange={(event) => updateConfig("minMomentumPct", Number(event.target.value))}
                />
                <strong>{config.minMomentumPct.toFixed(1)}%</strong>
              </label>
              <label className="slider-row">
                <span>Rel Strength</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.minRelativeStrengthPct}
                  onChange={(event) => updateConfig("minRelativeStrengthPct", Number(event.target.value))}
                />
                <strong>{config.minRelativeStrengthPct.toFixed(2)}%</strong>
              </label>
            </Panel>

            <Panel title="Target Tracker" icon={<TrendingUp size={18} />}>
              <div className="milestone-grid">
                {currentMilestones.levels.map((milestone) => (
                  <div className={milestone.hit ? "milestone hit" : "milestone"} key={milestone.pct}>
                    <span>{milestone.pct}%</span>
                    <strong>{milestone.hit ? "Hit" : "Waiting"}</strong>
                    <small>{formatCurrency(milestone.amount, 2)}</small>
                  </div>
                ))}
              </div>
              <div className="strategy-grid compact">
                <div>
                  <span>Peak</span>
                  <strong className={currentMilestones.peakPnl >= 0 ? "gain" : "loss"}>
                    {formatCurrency(currentMilestones.peakPnl, 2)}
                  </strong>
                </div>
                <div>
                  <span>Give-back</span>
                  <strong className={gaveBackFromPeak > 0 ? "loss" : "gain"}>{formatCurrency(gaveBackFromPeak, 2)}</strong>
                </div>
                <div>
                  <span>Lowest</span>
                  <strong className={currentMilestones.maxDrawdownPnl < 0 ? "loss" : "gain"}>
                    {formatCurrency(currentMilestones.maxDrawdownPnl, 2)}
                  </strong>
                </div>
                <div>
                  <span>Hit List</span>
                  <strong>{milestoneSummary(currentMilestones)}</strong>
                </div>
              </div>
            </Panel>

            <Panel title="Strategy Brain" icon={<Cpu size={18} />}>
              <div className="strategy-grid">
                <div>
                  <span>Top Signal</span>
                  <strong>{displayedSignalSymbol}</strong>
                </div>
                <div>
                  <span>Qualified</span>
                  <strong>{backendEligible || eligibleStocks.length}</strong>
                </div>
                <div>
                  <span>Score</span>
                  <strong>{displayedSignalScore}</strong>
                </div>
                <div>
                  <span>Momentum</span>
                  <strong className={displayedMomentum >= 0 ? "gain" : "loss"}>
                    {`${displayedMomentum.toFixed(2)}%`}
                  </strong>
                </div>
                <div>
                  <span>Relative Strength</span>
                  <strong className={displayedRelativeStrength >= 0 ? "gain" : "loss"}>
                    {`${displayedRelativeStrength.toFixed(2)}%`}
                  </strong>
                </div>
                <div>
                  <span>Market Regime</span>
                  <strong>{displayedMarketRegime}</strong>
                </div>
                <div>
                  <span>Data Source</span>
                  <strong>{sourceLabel(strategyPayload?.source ?? brokerStatus?.dataSource ?? "simulator")}</strong>
                </div>
                <div>
                  <span>Agent</span>
                  <strong className={displayedAgent === "TRADE" ? "gain" : displayedAgent === "LOCKED" ? "loss" : undefined}>
                    {displayedAgent}
                  </strong>
                </div>
                <div>
                  <span>Direction</span>
                  <strong className={displayedSide === "SELL" ? "loss" : "gain"}>{displayedDirection}</strong>
                </div>
                <div>
                  <span>Strategy</span>
                  <strong>{strategyLabel(displayedStrategy)}</strong>
                </div>
                <div>
                  <span>Risk / Trade</span>
                  <strong>{formatCurrency(strategyPayload?.decision.riskAmount ?? backendTopSignal?.positionRisk ?? 0, 2)}</strong>
                </div>
                <div>
                  <span>Net R:R</span>
                  <strong>{displayedNetRewardRisk.toFixed(2)}</strong>
                </div>
              </div>
              <p className="broker-note">{strategyBrainMessage}</p>
            </Panel>

            <Panel title="Live Risk Guard" icon={<ShieldCheck size={18} />}>
              <div className="strategy-grid">
                <div>
                  <span>Market</span>
                  <strong className={riskState?.marketOpen ? "gain" : "loss"}>{riskState?.sessionPhase ?? "closed"}</strong>
                </div>
                <div>
                  <span>Fresh Entries</span>
                  <strong className={riskState?.freshEntriesAllowed ? "gain" : "loss"}>
                    {riskState?.freshEntriesAllowed ? "Allowed" : "Blocked"}
                  </strong>
                </div>
                <div>
                  <span>Kill Switch</span>
                  <strong className={riskState?.killSwitchActive ? "loss" : "gain"}>
                    {riskState?.killSwitchActive ? "Active" : "Clear"}
                  </strong>
                </div>
                <div>
                  <span>Server P&L</span>
                  <strong className={(riskState?.dayPnl ?? 0) >= 0 ? "gain" : "loss"}>
                    {formatCurrency(riskState?.dayPnl ?? 0, 2)}
                  </strong>
                </div>
                <div>
                  <span>Trades</span>
                  <strong>{riskState?.tradesTaken ?? 0}/{config.maxTrades}</strong>
                </div>
              </div>
              <div className="report-actions">
                <button className={`mini-action ${riskState?.killSwitchActive ? "" : "danger"}`} type="button" onClick={toggleKillSwitch}>
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>{riskState?.killSwitchActive ? "Release" : "Kill Switch"}</span>
                </button>
                <button className="mini-action" type="button" onClick={() => refreshServerIntelligence()}>
                  <RefreshCw size={16} aria-hidden="true" />
                  <span>Refresh</span>
                </button>
              </div>
            </Panel>

            <Panel title="Broker Boundary" icon={<PlugZap size={18} />}>
              <div className="broker-grid">
                <BrokerLine
                  label="API Server"
                  value={brokerStatus ? "Online" : brokerError}
                  state={brokerStatus ? "active" : "warning"}
                />
                <BrokerLine label="Mode" value={brokerStatus?.mode === "live" ? "Live" : "Paper"} state="active" />
                <BrokerLine label="Paper Engine" value={paperEngineLabel} state="active" />
                <BrokerLine label="Broker" value={brokerStatus?.broker ?? "Zerodha-ready"} state="neutral" />
                <BrokerLine
                  label="API Key"
                  value={brokerStatus?.apiConfigured ? "Configured" : "Missing"}
                  state={brokerStatus?.apiConfigured ? "active" : "warning"}
                />
                <BrokerLine
                  label="Login Token"
                  value={brokerStatus?.tokenState === "ready" ? "Ready" : "Not connected"}
                  state={brokerStatus?.tokenState === "ready" ? "active" : "warning"}
                />
                <BrokerLine
                  label="Order Route"
                  value={brokerStatus?.orderRoute === "kite" ? "Kite" : "Simulator"}
                  state={brokerStatus?.orderRoute === "kite" ? "warning" : "active"}
                />
                <BrokerLine
                  label="Stream"
                  value={brokerStatus?.stream?.state ?? "idle"}
                  state={brokerStatus?.stream?.state === "open" && !brokerStatus.stream.stale ? "active" : "neutral"}
                />
                <BrokerLine
                  label="Rate Limit"
                  value={rateLimitDelayed ? `${rateLimitDelayed} delays` : "Clear"}
                  state={rateLimitDelayed ? "warning" : "active"}
                />
                <BrokerLine
                  label="Live Orders"
                  value={brokerStatus?.liveOrders === "armed" ? "Armed" : "Locked"}
                  state={brokerStatus?.liveOrders === "armed" ? "warning" : "active"}
                />
              </div>
            </Panel>

            <Panel title="Zerodha Login" icon={<KeyRound size={18} />}>
              <div className="token-box">
                <label>
                  <span>Request Token</span>
                  <input
                    type="text"
                    value={requestToken}
                    placeholder="Paste request_token"
                    autoComplete="off"
                    onChange={(event) => setRequestToken(event.target.value)}
                    disabled={!brokerStatus?.apiConfigured || brokerBusy}
                  />
                </label>
                <div className="report-actions">
                  <button className="mini-action" type="button" onClick={openZerodhaLogin} disabled={!canUseKiteAuth}>
                    <ExternalLink size={16} aria-hidden="true" />
                    <span>Open Kite</span>
                  </button>
                  <button className="mini-action" type="button" onClick={connectZerodhaSession} disabled={!canConnectKite}>
                    <KeyRound size={16} aria-hidden="true" />
                    <span>Connect</span>
                  </button>
                </div>
                <p className={brokerStatus?.apiConfigured ? "broker-note" : "broker-note warning"}>
                  {brokerMessage ||
                    (brokerStatus?.apiConfigured
                      ? "Daily login is required before live API use. This app still routes orders to paper mode."
                      : "Add Kite keys in .env, then restart the API server.")}
                </p>
              </div>
            </Panel>

            <Panel title="Execution Quality" icon={<AlertTriangle size={18} />}>
              <div className="quality-grid">
                <div>
                  <span>Orders</span>
                  <strong>{sim.stats.orders}</strong>
                </div>
                <div>
                  <span>Fills</span>
                  <strong>{sim.stats.fills}</strong>
                </div>
                <div>
                  <span>Rejected</span>
                  <strong>{sim.stats.rejections}</strong>
                </div>
                <div>
                  <span>Slippage</span>
                  <strong>{formatCurrency(sim.stats.slippageCost, 2)}</strong>
                </div>
              </div>
            </Panel>

            <Panel title="Backtest Lab" icon={<Activity size={18} />}>
              <div className="strategy-grid">
                <div>
                  <span>Trades</span>
                  <strong>{backtest?.trades ?? 0}</strong>
                </div>
                <div>
                  <span>Win Rate</span>
                  <strong>{backtest?.winRate ?? 0}%</strong>
                </div>
                <div>
                  <span>Net P&L</span>
                  <strong className={(backtest?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                    {formatCurrency(backtest?.netPnl ?? 0, 2)}
                  </strong>
                </div>
                <div>
                  <span>Drawdown</span>
                  <strong className="loss">{formatCurrency(backtest?.maxDrawdown ?? 0, 2)}</strong>
                </div>
                <div>
                  <span>Sharpe</span>
                  <strong>{(backtest?.sharpeRatio ?? 0).toFixed(2)}</strong>
                </div>
                <div>
                  <span>Profit Factor</span>
                  <strong>{(backtest?.profitFactor ?? 0).toFixed(2)}</strong>
                </div>
                <div>
                  <span>Avg Win</span>
                  <strong className="gain">{formatCurrency(backtest?.avgWin ?? 0, 2)}</strong>
                </div>
                <div>
                  <span>Avg Loss</span>
                  <strong className="loss">{formatCurrency(backtest?.avgLoss ?? 0, 2)}</strong>
                </div>
              </div>
              <div className="report-actions">
                <button className="mini-action" type="button" onClick={runBacktestNow} disabled={backtestBusy}>
                  <Activity size={16} aria-hidden="true" />
                  <span>{backtestBusy ? "Running" : "Run Test"}</span>
                </button>
                <button className="mini-action" type="button" onClick={() => refreshServerIntelligence()}>
                  <RefreshCw size={16} aria-hidden="true" />
                  <span>Load Latest</span>
                </button>
              </div>
              <p className={serverMessage ? "broker-note" : "broker-note warning"}>
                {serverMessage || "Backtests use Kite historical candles when connected, otherwise simulator candles."}
              </p>
            </Panel>

            <Panel title="Daily Reports" icon={<FileClock size={18} />}>
              <div className="report-grid">
                <div>
                  <span>Saved Days</span>
                  <strong>{reports.length}</strong>
                </div>
                <div>
                  <span>Win Rate</span>
                  <strong>{reportWinRate}%</strong>
                </div>
                <div>
                  <span>Last Net</span>
                  <strong className={(latestReport?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                    {latestReport ? formatCurrency(latestReport.netPnl, 2) : formatCurrency(0, 2)}
                  </strong>
                </div>
                <div>
                  <span>Last Status</span>
                  <strong>{latestReport ? statusLabel(latestReport.status) : "No Report"}</strong>
                </div>
              </div>
              <div className="report-actions">
                <button className="mini-action" type="button" onClick={exportJournal} disabled={!sim.trades.length}>
                  <Download size={16} aria-hidden="true" />
                  <span>Journal CSV</span>
                </button>
                <button className="mini-action" type="button" onClick={exportReports} disabled={!reports.length}>
                  <Database size={16} aria-hidden="true" />
                  <span>Reports CSV</span>
                </button>
              </div>
            </Panel>
          </div>
        </section>

        <section className="trade-band">
          <Panel title="Trade Journal" icon={<Activity size={18} />}>
            <div className="journal-toolbar">
              <div className="segmented-control" role="tablist" aria-label="Trade journal view">
                <button
                  type="button"
                  className={journalView === "session" ? "active" : ""}
                  onClick={() => setJournalView("session")}
                >
                  <Activity size={16} aria-hidden="true" />
                  <span>Session</span>
                </button>
              </div>
              <div className="journal-actions">
                {journalView === "history" ? (
                  <>
                    <button className="mini-action" type="button" onClick={() => refreshTradeHistory()}>
                      <RefreshCw size={16} aria-hidden="true" />
                      <span>Refresh</span>
                    </button>
                    <button className="mini-action" type="button" onClick={exportTradeHistory} disabled={!tradeHistory?.trades.length}>
                      <Download size={16} aria-hidden="true" />
                      <span>History CSV</span>
                    </button>
                  </>
                ) : (
                  <button className="mini-action" type="button" onClick={exportJournal} disabled={!sim.trades.length}>
                    <Download size={16} aria-hidden="true" />
                    <span>Journal CSV</span>
                  </button>
                )}
              </div>
            </div>

            {journalView === "session" ? (
              <div className="journal-table">
                <div className="journal-head">
                  <span>Time</span>
                  <span>Symbol</span>
                  <span>Side</span>
                  <span>Qty</span>
                  <span>Price</span>
                  <span>Charges</span>
                  <span>Net P&L</span>
                  <span>Status</span>
                </div>
                {sim.trades.length ? (
                  sim.trades.slice(0, 9).map((trade) => (
                    <div className="journal-row" key={trade.id}>
                      <span>{trade.time}</span>
                      <strong>{trade.symbol}</strong>
                      <span className={trade.side === "BUY" ? "gain" : "loss"}>{trade.side}</span>
                      <span>{trade.qty}</span>
                      <span>{formatCurrency(trade.price, 2)}</span>
                      <span>{formatCurrency(trade.charges, 2)}</span>
                      <span className={trade.pnl >= 0 ? "gain" : "loss"}>{formatCurrency(trade.pnl, 2)}</span>
                      <span>{trade.status}</span>
                    </div>
                  ))
                ) : (
                  <div className="journal-empty">Waiting for first signal</div>
                )}
              </div>
            ) : (
              <div className="history-view">
                <div className="history-summary">
                  <div>
                    <span>All Days Net</span>
                    <strong className={(historyTotals?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                      {formatCurrency(historyTotals?.netPnl ?? 0, 2)}
                    </strong>
                    <small>{formatPercent(historyTotals?.netPct ?? 0)} of capital</small>
                  </div>
                  <div>
                    <span>Today Net</span>
                    <strong className={(latestHistoryDay?.netPnl ?? 0) >= 0 ? "gain" : "loss"}>
                      {latestHistoryDay ? formatCurrency(latestHistoryDay.netPnl, 2) : formatCurrency(0, 2)}
                    </strong>
                    <small>{latestHistoryDay ? formatPercent(latestHistoryDay.netPct) : "0.00%"} of capital</small>
                  </div>
                  <div>
                    <span>Closed Trades</span>
                    <strong>{historyTotals?.closedTrades ?? 0}</strong>
                    <small>{formatPercent(historyTotals?.winRate ?? 0, 0)} win rate</small>
                  </div>
                  <div>
                    <span>Open / Unmatched</span>
                    <strong className={(historyTotals?.openTrades ?? 0) > 0 ? "warning" : undefined}>
                      {historyTotals?.openTrades ?? 0}
                    </strong>
                    <small>{historyTotals?.rejectedOrders ?? 0} rejected</small>
                  </div>
                </div>

                {historyError ? <p className="broker-note warning">{historyError}</p> : null}
                {(historyTotals?.openTrades ?? 0) > 0 ? (
                  <p className="broker-note warning">
                    {historyTotals?.openTrades} entry {historyTotals?.openTrades === 1 ? "order has" : "orders have"} no recorded exit. Closed net excludes unmatched rows.
                  </p>
                ) : null}

                {tradeHistory?.daily.length ? (
                  <div className="daily-history-strip">
                    {tradeHistory.daily.slice(0, 6).map((day) => (
                      <div key={day.date}>
                        <span>{formatDate(day.date)}</span>
                        <strong className={day.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(day.netPnl, 2)}</strong>
                        <small>
                          {formatPercent(day.netPct)} · {day.trades} trade{day.trades === 1 ? "" : "s"}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="history-table">
                  <div className="history-head">
                    <span>Date</span>
                    <span>Entry</span>
                    <span>Exit</span>
                    <span>Symbol</span>
                    <span>Side</span>
                    <span>Qty</span>
                    <span>Entry</span>
                    <span>Exit</span>
                    <span>Charges</span>
                    <span>Net P&L</span>
                    <span>Return</span>
                    <span>Status</span>
                  </div>
                  {tradeHistory?.trades.length ? (
                    tradeHistory.trades.map((trade) => (
                      <div className="history-row" key={trade.id}>
                        <span>{formatDate(trade.date)}</span>
                        <span>{formatDateTime(trade.entryAt)}</span>
                        <span>{formatDateTime(trade.exitAt)}</span>
                        <strong>{trade.symbol}</strong>
                        <span className={trade.side === "LONG" ? "gain" : "loss"}>{trade.side}</span>
                        <span>{trade.quantity}</span>
                        <span>{formatCurrency(trade.entryPrice, 2)}</span>
                        <span>{trade.exitPrice ? formatCurrency(trade.exitPrice, 2) : "-"}</span>
                        <span>{formatCurrency(trade.charges, 2)}</span>
                        <span className={trade.netPnl >= 0 ? "gain" : "loss"}>{formatCurrency(trade.netPnl, 2)}</span>
                        <span className={trade.netPct >= 0 ? "gain" : "loss"}>{formatPercent(trade.netPct)}</span>
                        <span className={trade.status === "OPEN" ? "warning" : undefined}>{trade.status}</span>
                      </div>
                    ))
                  ) : (
                    <div className="journal-empty">No backend trade history yet</div>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </section>
          </>
        ) : activeView === "history" ? (
          tradeHistoryView
        ) : (
          analyticsView
        )}
      </main>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong className={tone}>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <span>{icon}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function BrokerLine({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "active" | "warning" | "neutral";
}) {
  return (
    <div className="broker-line">
      <span>{label}</span>
      <strong className={state}>{value}</strong>
    </div>
  );
}

export default App;
