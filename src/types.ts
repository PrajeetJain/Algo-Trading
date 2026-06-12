export type Theme = "light" | "dark";
export type BotStatus = "idle" | "running" | "paused" | "target-hit" | "loss-hit" | "closed";
export type TradeStatus = "ENTRY" | "EXIT" | "REJECTED";
export type TradeSide = "BUY" | "SELL";
export type PositionSide = "LONG" | "SHORT";
export type OrderIntent = "ENTRY" | "EXIT";

export type Stock = {
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

export type Position = {
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

export type Trade = {
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

export type Config = {
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
  maxVix: number;
  maxGapPct: number;
  strategyMode: "hybrid" | "momentum" | "mean-reversion" | "vwap-pullback" | "opening-range";
};

export type ExecutionStats = {
  orders: number;
  fills: number;
  rejections: number;
  slippageCost: number;
};

export type ProfitMilestone = {
  pct: number;
  amount: number;
  hit: boolean;
  hitAt: string | null;
  pnlAtHit: number | null;
};

export type MilestoneState = {
  levels: ProfitMilestone[];
  peakPnl: number;
  peakPct: number;
  peakAt: string | null;
  maxDrawdownPnl: number;
  maxDrawdownPct: number;
  maxDrawdownAt: string | null;
};

export type Simulation = {
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

export type DailyReport = {
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

export type BrokerStatus = {
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
  notifications?: { telegramConfigured: boolean };
  paperBot?: { status: BotStatus; lastTickAt: string | null; healthy: boolean; openPositions: number } | null;
};

export type MarketRegime = {
  state: string;
  bias: "bullish" | "bearish" | "neutral";
  trendPct: number;
  volatility: string;
  atrPct: number;
  vix?: number | null;
  breadth?: string;
  label: string;
};

export type BackendSignal = {
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
  sectorIndexBiasPct?: number;
  gapPct?: number;
  sectorRank?: number;
  rsRank?: number;
  rsPercentile?: number;
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

export type StrategyPayload = {
  source: "simulator" | "kite-rest" | "kite-ws" | "kite-ws-rest-depth" | "kite-error";
  generatedAt: string;
  marketRegime?: MarketRegime | null;
  dataQuality?: { missingQuotes: string[]; quoteCount: number };
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

export type RiskState = {
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
  holidayListStale?: boolean;
  nextOpenAt: string | null;
  targetAmount: number;
  lossAmount: number;
  liveOrderPolicy: string;
};

export type BacktestResult = {
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

export type TradePerformanceRow = {
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

export type SignalQualityRow = {
  key: string;
  samples: number;
  eligible: number;
  tradeDecisions: number;
  eligibleRate: number;
  avgScore: number;
  avgRelativeStrength: number;
  avgNetRewardRisk: number;
};

export type RegimeQualityRow = {
  key: string;
  snapshots: number;
  tradeDecisions: number;
  eligibleSignals: number;
  totalSignals: number;
  eligibleRate: number;
};

export type RecentSignalRow = {
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

export type AnalyticsPayload = {
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
    byHour: TradePerformanceRow[];
    byEntryRegime: TradePerformanceRow[];
  };
  signalQuality: {
    byStrategy: SignalQualityRow[];
    bySymbol: SignalQualityRow[];
    bySide: SignalQualityRow[];
    byRegime: RegimeQualityRow[];
    byScoreBucket: SignalQualityRow[];
    bySpreadBucket: SignalQualityRow[];
    byRelativeStrengthBucket: SignalQualityRow[];
    recent: RecentSignalRow[];
  };
};

export type QualityTradeRow = {
  id: string;
  tradeDate: string;
  symbol: string;
  side: PositionSide;
  strategy?: string;
  quantity: number;
  entryAt: string;
  exitAt: string | null;
  timeInTradeMin: number;
  exitReason: string;
  netPnl: number;
  grossPnl: number;
  charges: number;
  mfeAmount: number;
  maeAmount: number;
  rMultiple: number;
  captureRatio: number;
};

export type TradeQualityPayload = {
  generatedAt: string;
  capital: number;
  totals: {
    closedTrades: number;
    netPnl: number;
    avgTimeInTradeMin: number;
    avgMfeAmount: number;
    avgMaeAmount: number;
    avgRMultiple: number;
    avgCaptureRatio: number;
    chargesPctOfGross: number;
  };
  exitReasons: Array<{ reason: string; trades: number; netPnl: number }>;
  milestoneFrequency: Array<{
    pct: number;
    amount: number;
    daysHit: number;
    daysHeld: number;
    hitRate: number;
    holdRate: number;
  }>;
  dayStats: Array<{
    tradeDate: string;
    peakPnl: number;
    troughPnl: number;
    lastPnl: number;
    gaveBack: number;
  }>;
  trades: QualityTradeRow[];
};

export type HistoryTrade = {
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

export type DailyTradeSummary = {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  netPct: number;
};

export type TradeHistoryPayload = {
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

export type EnginePosition = {
  id: string;
  status: "OPEN" | "CLOSED";
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  entryAt: string;
  tradeDate: string;
  stopLoss: number | null;
  initialStop?: number | null;
  target: number | null;
  strategy?: Config["strategyMode"];
  score: number;
  lastPrice: number;
  mfe: number;
  mae: number;
  currentPnl: number;
};

export type EngineTrade = {
  id: string;
  time: string;
  symbol: string;
  side: TradeSide;
  qty: number;
  price: number;
  charges: number;
  pnl: number;
  status: TradeStatus;
  reason?: string;
};

export type PaperEngineState = {
  status: BotStatus;
  tradeDate: string;
  startedAt: string | null;
  closedAt: string | null;
  lastTickAt: string | null;
  lastMessage: string;
  config: Config;
  positions: EnginePosition[];
  sessionTrades: EngineTrade[];
  stats: ExecutionStats;
  realizedPnl: number;
  unrealizedPnl: number;
  dayPnl: number;
  tradesTaken: number;
  maxTrades: number;
  dataSource: string;
  pnlSeries: Array<{ t: string; pnl: number }>;
  heartbeat: { lastTickAt: string | null; healthy: boolean };
};

export type CandlePayload = {
  source: string;
  symbol: string;
  candles: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
};

export type Toast = {
  id: string;
  tone: "gain" | "loss" | "info";
  title: string;
  body: string;
};

export type VerdictCriterion = {
  id: string;
  label: string;
  required: string;
  actual: string;
  pass: boolean;
  gating: "data" | "performance";
};

export type VerdictPayload = {
  generatedAt: string;
  capital: number;
  verdict: "GO" | "NO-GO" | "NOT-YET";
  verdictText: string;
  criteria: VerdictCriterion[];
  metrics: {
    tradingDays: number;
    closedTrades: number;
    netPnl: number;
    charges: number;
    chargesPctOfGross: number;
    winRate: number;
    expectancy: number;
    expectancyPctOfCapital: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    maxDrawdown: number;
    maxDrawdownPctOfCapital: number;
    maxConsecutiveLosingTrades: number;
    maxConsecutiveLosingDays: number;
    dailyAvgPnl: number;
    sharpeDaily: number;
    sharpeAnnualized: number;
    tStatistic: number;
    avgGiveBackPerDay: number;
    walkForwardOosPnl: number | null;
    walkForwardOverfit: boolean | null;
  };
  equityCurve: Array<{ date: string; equity: number }>;
  failedCriteria: string[];
  performanceFailures: number;
};

export const MARKET_OPEN = "09:15";
export const MARKET_CLOSE = "15:30";
export const CONFIG_STORAGE_KEY = "aindra-config";
export const CONFIG_VERSION_STORAGE_KEY = "aindra-config-version";
export const SIM_STORAGE_KEY = "aindra-current-session";
export const REPORTS_STORAGE_KEY = "aindra-daily-reports";
export const LOCAL_RESET_STORAGE_KEY = "aindra-local-reset-version";
export const LOCAL_RESET_VERSION = "2026-06-09-clean-50k-v1";
export const SAFE_CONFIG_VERSION = "8";
export const PROFIT_MILESTONE_PCTS = [0.25, 0.5, 0.75, 1];

// Capital 2L: positions sized off 0.25% risk reach ~Rs 62k/side, so the
// whole 26-symbol watchlist is tradeable with clean share rounding, and the
// Rs 20 brokerage cap is within reach on wider positions.
export const defaultConfig: Config = {
  capital: 200000,
  targetPct: 1,
  maxLossPct: 1,
  maxTrades: 3,
  slippageBps: 8,
  minScore: 70,
  minMomentumPct: 0.1,
  maxSpreadBps: 18,
  riskPerTradePct: 0.25,
  // Lab-mapped geometry (Jun 2026): tighter stops monotonically lost more
  // (noise harvesting); S1.2/T1.8 sits mid-frontier of the tested gradient.
  stopLossPct: 1.2,
  takeProfitPct: 1.8,
  atrStopMultiplier: 1.5,
  minRelativeStrengthPct: 0.05,
  minNetRewardRisk: 1.2,
  maxVix: 28,
  maxGapPct: 3,
  strategyMode: "hybrid",
};
